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
import rondo_server/games/veryare/oni_cpu.{type Strength}
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage.{type Skeleton}

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
  )
}

/// 骨格・強さ・種を決めて1試合を回す。exploration_ms は探索フェーズの長さ。
pub fn run(
  skeleton: Skeleton,
  strength: Strength,
  seed: Int,
  exploration_ms: Int,
) -> Match {
  let layout = stage.generate_on(skeleton, seed)
  let oni = "cpu-0"
  let hiders =
    list.map(numbers(1, hider_count), fn(n) { "cpu-" <> int.to_string(n) })
  let start =
    game.new_with(
      [oni, ..hiders],
      game.durations(exploration_ms:),
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

  let #(after, find_seconds, explore_anomalies) =
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
  )
}

/// 探索を tick で進める。時間切れでフェーズのタイマーを満了させる。
fn explore(
  g: Game(String),
  elapsed_ms: Int,
  limit_ms: Int,
  found: List(Float),
  anomalies: List(String),
) -> #(Game(String), List(Float), List(String)) {
  case g.phase {
    Exploration ->
      case elapsed_ms >= limit_ms {
        True -> #(game.advance(g, g.step, fn(_) { 0 }), found, anomalies)
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
    _ -> #(g, found, anomalies)
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
  let through = case after.oni_cpu, after.oni, dict.get(before.positions, id) {
    Some(walker), Some(oni), Ok(Position(Stage, x, z)) -> {
      let map = after.sight_map
      let hider_region = sight.region_at(map, sight.cell_of(#(x, z)))
      let oni_region = case dict.get(after.positions, oni) {
        Ok(Position(_, ox, oz)) ->
          sight.region_at(map, sight.cell_of(#(ox, oz)))
        Error(Nil) -> Error(Nil)
      }
      case hider_region {
        Ok(sight.Room(slot)) ->
          case
            oni_region == Ok(sight.Room(slot)) || door_open(after, walker, slot)
          {
            True -> []
            False -> ["壁や閉じた襖の向こうを見つけた"]
          }
        _ -> []
      }
    }
    _, _, _ -> []
  }
  list.append(seen, through)
}

fn door_open(g: Game(String), walker: oni_cpu.OniCpu, slot_id: String) -> Bool {
  case list.find(g.layout.skeleton.slots, fn(slot) { slot.id == slot_id }) {
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
