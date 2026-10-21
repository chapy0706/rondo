/// 鬼 CPU と隠れ CPU だけの対戦を、画面なしで回す（ADR 0038 / issue-34）。
///
/// ルームやタイマーは使わず、純粋な状態機械（game）をシミュレーション上の時刻で直接
/// 進める。鬼 CPU は 0.5秒ごとの tick、フェーズはそれぞれの長さが経ったら advance。
/// 1試合ごとに、ADR 0028 の条件に照らした異常を調べる。
///
/// - フェーズが終了まで進まない
/// - 閉じた襖の向こう（その部屋の外から）で隠れ側を見つけた／視界に無い隠れ側を見つけた
/// - 被りの失格が想定と違う（隠れ CPU は被らない位置に置くので、失格は 0 人のはず）
/// - 「まだ隠れている」集合が増えた
import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/set
import gleam/string
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, HidersWin, Position, Reveal, Stage,
}
import rondo_server/games/veryare/hider_cpu
import rondo_server/games/veryare/oni_cpu.{type Strength}
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage.{type Layout, type Skeleton}
import rondo_server/games/veryare/stage_timing

/// 隠れ CPU の数（定員5人 = 鬼1 + 隠れ側4 のうち、鬼 CPU との対戦では3体まで並べる）。
pub const hider_count = 3

/// 1試合の結果。
pub type Match {
  Match(
    hiders_win: Bool,
    /// 見つかった隠れ側ごとの、探索開始から見つかるまでの秒数。
    find_seconds: List(Float),
    /// 終了まで進んだか。
    finished: Bool,
    anomalies: List(String),
    /// 試合の長さ（秒）。準備移動・ペイント・探索（全員が見つかったら、そこまで）・答え合わせの合計
    /// （issue-65 の 10 種と広い屋敷の比較に使う）。
    length_seconds: Float,
  )
}

/// 骨格・強さ・種を決めて1試合を回す。exploration_ms は、ルームで選んだ探索フェーズの長さ。
/// フェーズの長さは、ルームと同じく骨格に合わせる（広い屋敷は準備移動を骨格から計算し、探索 +80 秒 /
/// issue-65。10 種は、そのまま）。
pub fn run(
  skeleton: Skeleton,
  strength: Strength,
  seed: Int,
  exploration_ms: Int,
) -> Match {
  let durations =
    stage_timing.durations_for(game.durations(exploration_ms:), skeleton)
  let exploration_ms = durations.exploration_ms
  let layout = stage.generate_on(skeleton, seed)
  let oni = "cpu-0"
  let hiders =
    list.map(numbers(1, hider_count), fn(n) { "cpu-" <> int.to_string(n) })
  let start =
    game.new_with(
      [oni, ..hiders],
      durations,
      layout,
      game.Cpus(hiders:, oni: Some(oni), strength:),
    )
  // 乱数は種から決める（同じ種なら同じ試合）。
  let pick = seeded_pick(seed)
  let counting = case hiders {
    [first, ..] -> game.move(start, first, 0.0, 0.0)
    [] -> start
  }
  let preparation = expire(counting, pick)
  let painting = expire(preparation, pick)
  let exploration = expire(painting, pick)

  let anomalies = case
    painting.phase,
    set.size(painting.still_hiding) == hider_count
  {
    game.Painting, True -> []
    _, _ -> ["被りの失格が想定と違う"]
  }

  let #(after, find_seconds, explore_anomalies, explored_ms) =
    explore(exploration, 0, exploration_ms, [], [])
  // 答え合わせの後に終了する。
  let ended = case after.phase {
    Reveal(_) -> expire(after, pick)
    _ -> after
  }
  let finished = case ended.phase {
    Ended(_) -> True
    _ -> False
  }
  let anomalies =
    list.flatten([
      anomalies,
      explore_anomalies,
      case finished {
        True -> []
        False -> ["フェーズが進まない"]
      },
    ])
  Match(
    hiders_win: ended.phase == Ended(HidersWin),
    find_seconds: list.reverse(find_seconds),
    finished:,
    anomalies:,
    length_seconds: int.to_float(
      durations.preparation_ms
      + durations.painting_ms
      + explored_ms
      + durations.reveal_ms,
    )
      /. 1000.0,
  )
}

/// 探索を tick で進める。時間切れでフェーズのタイマーを満了させる。4 つ目は、探索が続いた長さ（ミリ秒）。
fn explore(
  g: Game(String),
  elapsed_ms: Int,
  limit_ms: Int,
  found: List(Float),
  anomalies: List(String),
) -> #(Game(String), List(Float), List(String), Int) {
  case g.phase {
    Exploration ->
      case elapsed_ms >= limit_ms {
        True -> #(
          game.advance(g, g.step, fn(_) { 0 }),
          found,
          anomalies,
          elapsed_ms,
        )
        False -> {
          let next = game.tick(g)
          let elapsed = elapsed_ms + 500
          let lost = set.difference(g.still_hiding, next.still_hiding)
          let grew = !set.is_subset(next.still_hiding, g.still_hiding)
          let seconds = int.to_float(elapsed) /. 1000.0
          let found =
            list.fold(set.to_list(lost), found, fn(acc, _) { [seconds, ..acc] })
          let anomalies =
            list.flatten([
              anomalies,
              case grew {
                True -> ["「まだ隠れている」集合が増えた"]
                False -> []
              },
              list.flat_map(set.to_list(lost), fn(id) {
                found_check(g, next, id)
              }),
            ])
          explore(next, elapsed, limit_ms, found, anomalies)
        }
      }
    _ -> #(g, found, anomalies, elapsed_ms)
  }
}

/// 見つけ方が正しいか。視界に入っていたか、そして閉じた襖の向こう（部屋の外から）で
/// 見つけていないか。後者は見通しの判定とは別に、領域と襖の状態だけで確かめる。
fn found_check(
  before: Game(String),
  after: Game(String),
  id: String,
) -> List(String) {
  let seen = case list.contains(after.seen, id) {
    True -> []
    False -> ["視界に無い隠れ側を見つけた"]
  }
  let through = case
    after.oni_cpu,
    after.oni,
    dict.get(before.positions, id),
    after.ground
  {
    Some(walker),
      Some(oni),
      Ok(Position(Stage, x, z)),
      game.Skeleton(layout:, sight_map: map)
    -> {
      let hider_region = sight.region_at(map, sight.cell_of(#(x, z)))
      let oni_region = case dict.get(after.positions, oni) {
        Ok(Position(_, ox, oz)) ->
          sight.region_at(map, sight.cell_of(#(ox, oz)))
        Error(Nil) -> Error(Nil)
      }
      case hider_region {
        Ok(sight.Room(slot)) ->
          case
            oni_region == Ok(sight.Room(slot))
            || door_open(layout, walker, slot)
          {
            True -> []
            False -> ["壁や閉じた襖の向こうを見つけた"]
          }
        _ -> []
      }
    }
    _, _, _, _ -> []
  }
  list.append(seen, through)
}

fn door_open(layout: Layout, walker: oni_cpu.OniCpu, slot_id: String) -> Bool {
  case list.find(layout.skeleton.slots, fn(slot) { slot.id == slot_id }) {
    Ok(slot) ->
      list.any(slot.doors, fn(door) { set.contains(walker.open_doors, door) })
    Error(Nil) -> False
  }
}

fn expire(g: Game(String), pick: fn(Int) -> Int) -> Game(String) {
  game.advance(g, g.step, pick)
}

/// 種から作る、決定的な pick（0 以上 size 未満）。同じ種なら同じ試合になる。
fn seeded_pick(seed: Int) -> fn(Int) -> Int {
  fn(size) { stage.normalize(seed * 7919 + 13) % int.max(size, 1) }
}

fn numbers(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..numbers(from + 1, to)]
  }
}

// --- 観戦ルームの設定（issue-67） ---------------------------------------------------

/// 観戦ルームの隠れ CPU の数（観戦ルームの上限）。
pub const spectate_hider_count = 4

/// 観戦ルームと同じ始まり方の 1 試合。鬼 CPU 1 体と、歩く隠れ CPU 4 体で、鬼選出を飛ばして準備移動から
/// 始める（room.gleam の start_spectating と同じ）。異常には、run と同じもの（ADR 0028）に、歩きの決まり
/// （4 体とも道が決まる・準備移動の時間内に着く・被らない）を足す。
pub fn run_spectate(
  skeleton: Skeleton,
  strength: Strength,
  seed: Int,
  exploration_ms: Int,
) -> Match {
  let durations =
    stage_timing.durations_for(game.durations(exploration_ms:), skeleton)
  let exploration_ms = durations.exploration_ms
  let layout = stage.generate_on(skeleton, seed)
  let oni = "cpu-1"
  let hiders =
    list.map(numbers(2, spectate_hider_count + 1), fn(n) {
      "cpu-" <> int.to_string(n)
    })
  let pick = seeded_pick(seed)
  let preparation =
    game.new_with(
      [oni, ..hiders],
      durations,
      layout,
      game.Cpus(hiders:, oni: Some(oni), strength:),
    )
    |> game.with_walking_cpus
    |> game.begin_without_selection(pick)
  let reach = hider_cpu.reach_ms(durations.preparation_ms)
  let walk_anomalies =
    list.flat_map(hiders, fn(id) {
      case game.cpu_walk(preparation, id) {
        Ok(walk) ->
          case hider_cpu.arrival_ms(walk) <= reach {
            True -> []
            False -> ["隠れ CPU が準備移動の時間内に着かない"]
          }
        Error(Nil) -> ["隠れ CPU の歩く道が決まらない"]
      }
    })
  let painting = expire(preparation, pick)
  let overlap_anomalies = case
    painting.phase,
    set.size(painting.still_hiding) == spectate_hider_count
  {
    game.Painting, True -> []
    _, _ -> ["被りの失格が想定と違う"]
  }
  let exploration = expire(painting, pick)
  let #(after, find_seconds, explore_anomalies, explored_ms) =
    explore(exploration, 0, exploration_ms, [], [])
  let ended = case after.phase {
    Reveal(_) -> expire(after, pick)
    _ -> after
  }
  let finished = case ended.phase {
    Ended(_) -> True
    _ -> False
  }
  Match(
    hiders_win: ended.phase == Ended(HidersWin),
    find_seconds: list.reverse(find_seconds),
    finished:,
    anomalies: list.flatten([
      walk_anomalies,
      overlap_anomalies,
      explore_anomalies,
      case finished {
        True -> []
        False -> ["フェーズが進まない"]
      },
    ]),
    length_seconds: int.to_float(
      durations.preparation_ms
      + durations.painting_ms
      + explored_ms
      + durations.reveal_ms,
    )
      /. 1000.0,
  )
}

/// 観戦ルームの既定の選び方の結果。within は、鬼の勝率が 40〜60% に収まっているか。
pub type SpectateChoice {
  SpectateChoice(
    strength: Strength,
    seconds: Int,
    oni_rate: Float,
    within: Bool,
  )
}

/// 鬼の勝率の下限と上限（観戦ルームの見どころ。どちらかが勝ちすぎない）。
pub const spectate_oni_rate_min = 0.4

pub const spectate_oni_rate_max = 0.6

/// (強さ, 探索の秒, 鬼の勝率) の表から、観戦ルームの既定を選ぶ。40〜60% に収まるもののうち、50% に最も
/// 近いもの（同じ近さなら、表の先のもの）。収まるものが無ければ、50% に最も近いものを、within: False で
/// 返す。表が空なら Error。
pub fn pick_spectate_default(
  rows: List(#(Strength, Int, Float)),
) -> Result(SpectateChoice, Nil) {
  let within = fn(rate) {
    rate >=. spectate_oni_rate_min && rate <=. spectate_oni_rate_max
  }
  let closest = fn(candidates: List(#(Strength, Int, Float))) {
    list.fold(candidates, Error(Nil), fn(best, row) {
      let distance = float.absolute_value(row.2 -. 0.5)
      case best {
        Ok(#(_, d)) if d <=. distance -> best
        _ -> Ok(#(row, distance))
      }
    })
  }
  case closest(list.filter(rows, fn(row) { within(row.2) })) {
    Ok(#(#(strength, seconds, rate), _)) ->
      Ok(SpectateChoice(strength, seconds, rate, True))
    Error(Nil) ->
      case closest(rows) {
        Ok(#(#(strength, seconds, rate), _)) ->
          Ok(SpectateChoice(strength, seconds, rate, False))
        Error(Nil) -> Error(Nil)
      }
  }
}

// --- 集計 ----------------------------------------------------------------

/// 集計の1行。
pub type Summary {
  Summary(
    matches: Int,
    hider_win_rate: Float,
    /// 1試合で見つかった隠れ側の平均人数。
    average_found: Float,
    /// 見つかった隠れ側の、見つかるまでの平均秒数（見つかった人がいなければ 0）。
    average_find_seconds: Float,
    finished_rate: Float,
    anomalies: Int,
    /// 試合の平均の長さ（秒 / issue-65）。
    average_length_seconds: Float,
  )
}

pub fn summarize(matches: List(Match)) -> Summary {
  let count = list.length(matches)
  let n = int.to_float(int.max(count, 1))
  let wins = list.count(matches, fn(m) { m.hiders_win })
  let finished = list.count(matches, fn(m) { m.finished })
  let finds = list.flat_map(matches, fn(m) { m.find_seconds })
  let average = case finds {
    [] -> 0.0
    _ -> float.sum(finds) /. int.to_float(list.length(finds))
  }
  Summary(
    matches: count,
    hider_win_rate: int.to_float(wins) /. n,
    average_found: int.to_float(list.length(finds)) /. n,
    average_find_seconds: average,
    finished_rate: int.to_float(finished) /. n,
    anomalies: list.fold(matches, 0, fn(acc, m) {
      acc + list.length(m.anomalies)
    }),
    average_length_seconds: float.sum(
      list.map(matches, fn(m) { m.length_seconds }),
    )
      /. n,
  )
}

/// 集計の1行を表の形にする。
pub fn format_row(label: String, summary: Summary) -> String {
  string.join(
    [
      string.pad_end(label, 14, " "),
      string.pad_start(int.to_string(summary.matches), 6, " "),
      string.pad_start(percent(summary.hider_win_rate), 8, " "),
      string.pad_start(one_decimal(summary.average_found), 8, " "),
      string.pad_start(one_decimal(summary.average_find_seconds), 9, " "),
      string.pad_start(percent(summary.finished_rate), 8, " "),
      string.pad_start(int.to_string(summary.anomalies), 6, " "),
    ],
    " ",
  )
}

/// 10 種と広い屋敷の比較の1行（issue-65）。隠れ勝率・試合の平均の長さ（秒）・異常。
pub fn format_comparison(label: String, summary: Summary) -> String {
  string.join(
    [
      string.pad_end(label, 14, " "),
      string.pad_start(int.to_string(summary.matches), 6, " "),
      string.pad_start(percent(summary.hider_win_rate), 8, " "),
      string.pad_start(one_decimal(summary.average_length_seconds), 10, " "),
      string.pad_start(int.to_string(summary.anomalies), 6, " "),
    ],
    " ",
  )
}

/// 比較の表の見出し。
pub const comparison_header = "種類・強さ        試合  隠れ勝率  平均試合秒  異常"

/// 表の見出し。
pub const header = "骨格・強さ        試合  隠れ勝率  発見人数  平均発見秒  終了率  異常"

fn percent(rate: Float) -> String {
  int.to_string(float.round(rate *. 100.0)) <> "%"
}

fn one_decimal(value: Float) -> String {
  let tenths = float.round(value *. 10.0)
  int.to_string(tenths / 10)
  <> "."
  <> int.to_string(int.absolute_value(tenths % 10))
}

/// 強さの表示名。
pub fn strength_name(strength: Strength) -> String {
  case strength {
    oni_cpu.Weak -> "よわい"
    oni_cpu.Normal -> "ふつう"
    oni_cpu.Strong -> "つよい"
  }
}

pub fn strengths() -> List(Strength) {
  [oni_cpu.Weak, oni_cpu.Normal, oni_cpu.Strong]
}
