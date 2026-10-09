/// veryare の進行（ADR 0024）を表す純粋な状態機械。
///
/// フェーズは 鬼選出 → 準備移動 → ペイント → 探索 → 答え合わせ → 終了 の順に、タイマーの
/// 満了で進む。時刻と乱数は外から渡し（advance の step と pick）、ここはプロセスも時計も
/// 持たない。ルームへの載せ方は games/veryare/room.gleam が受け持つ。
///
/// 鬼選出のカウントダウン（10秒）は、鬼希望エリアへの最初の接触で始まる（ADR 0024）。
/// その時点で2人未満なら始めない。カウント中に触れた人は立候補者に加わり、カウント中の
/// 入退室は許す。満了時に2人未満なら不成立。鬼選出中だけは途中から入室できる。
/// 準備移動が終わった後（ペイント・探索）は、隠れ側は動けない。
/// 勝敗が決まると、不成立を除いて答え合わせタイム（20秒 / ADR 0033）を挟んでから終了する。
///
/// 「まだ隠れている」集合（still_hiding）は、接続中かつ未発見の隠れ側と定義する。
/// 発見（found）と、猶予を過ぎた切断（leave）は、どちらも remove_hider だけを通って
/// この集合から抜ける。個別の分岐を持たないので、結果の状態は完全に一致する。
/// 準備移動フェーズの終わりの被り判定（ADR 0026）で失格した隠れ側も、同じ remove_hider を通る。
///
/// ステージ（骨格と部屋の割り当て / ADR 0032）は開始時に受け取って持つ。隠れ CPU の置き場所、
/// 玄関からのリスポーン、ステージでの移動の規則（grid / issue-29a・ADR 0042）に使う。
///
/// CPU（ADR 0038 / issue-33）は参加者の一種として players に入り、人数の判定・勝敗・
/// 「まだ隠れている」集合に人間と同じように入る。違いは3つだけ: 隠れ側 CPU は鬼の抽選の
/// 対象にならない。鬼 CPU がいれば抽選をせずにその CPU が鬼になる。隠れ側 CPU は準備移動の
/// 終わりに、被り判定の直前に位置・ポーズ・ペイントを確定させる（hider_cpu）。
///
/// 鬼 CPU（issue-34）は、探索の開始時に玄関から出て、0.5秒ごとの tick で歩いて探す
/// （oni_cpu）。見つけた隠れ側は、人間の鬼が当てたときと同じ found を通る。
///
/// 人間の鬼の射撃（issue-27 / ADR 0022）は shoot で受ける。判定はここ（サーバー）が行い、
/// 命中したら found を通る。勝敗の判定は増やさない。
import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/set.{type Set}
import rondo_server/games/veryare/grid.{type Edge, type Grid}
import rondo_server/games/veryare/hider_cpu.{type Placement}
import rondo_server/games/veryare/oni_cpu.{type OniCpu, type Strength}
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage.{type Layout}

// --- 定数 ----------------------------------------------------------------

/// 鬼選出のカウントダウンの長さ（ミリ秒）。エリアへの最初の接触から数える。
pub const oni_selection_ms = 10_000

/// 準備移動フェーズの長さ（ミリ秒）。
pub const preparation_ms = 20_000

/// ペイントフェーズの長さ（ミリ秒）。
pub const painting_ms = 20_000

/// 答え合わせタイムの長さ（ミリ秒 / ADR 0033）。
pub const reveal_ms = 20_000

/// 鬼が撃つ間隔（ミリ秒 / issue-27・ADR 0022 のリロード）。
pub const reload_ms = 3000

/// 射撃の射程（メートル / issue-27）。調整できるよう定数にする。
pub const shot_range = 8.0

/// 最小人数（鬼1 + 隠れ側1 / ADR 0030）。鬼選出のカウントダウンの開始と成立に使う。
pub const min_players = 2

/// 隠れ CPU の配置の種を引く範囲。
const cpu_seed_range = 2_147_483_647

/// 待機ルームの半径（メートル）。円柱形で、床は直径約4m（8畳相当）の円。
pub const waiting_room_radius = 2.0

/// 鬼希望エリア（待機ルームと同心円）の半径（メートル）。
pub const oni_area_radius = 0.6

/// 待機ルームで並ぶ輪の半径。鬼希望エリアの外に置き、立候補は自分で入った人だけにする。
const waiting_ring_radius = 1.3

/// 待機ルームの輪の席の数（定員と同じ5席）。途中で入室しても既にいる人を動かさない。
const waiting_ring_seats = 5

// --- 型 ------------------------------------------------------------------

/// 勝敗。NotEnoughPlayers は鬼選出の時点で2人未満だったときの不成立。
pub type Outcome {
  OniWins
  HidersWin
  NotEnoughPlayers
}

/// フェーズ（ADR 0024 / 0033）。Reveal は答え合わせタイム、Ended は終了/観戦。
pub type Phase {
  OniSelection
  Preparation
  Painting
  Exploration
  Reveal(outcome: Outcome)
  Ended(outcome: Outcome)
}

/// 鬼希望エリアの見た目の状態（ADR 0024）。
pub type AreaState {
  /// 赤・「待機」。2人未満。触れても何も起きない。
  AreaWaiting
  /// 緑・「開始」。2人以上。触れるとカウントダウンが始まる。
  AreaReady
  /// 青・「鬼希望」。カウントダウン中。触れた人は立候補者になる。
  AreaCounting
}

/// プレイヤーがいる空間。待機ルームとステージは別の空間として扱う。
pub type Space {
  WaitingRoom
  Stage
}

/// 床の上の位置（x, z）。高さは持たない。
pub type Position {
  Position(space: Space, x: Float, z: Float)
}

/// 各フェーズの長さ（ミリ秒）。探索だけがルームごとの設定値。
pub type Durations {
  Durations(
    oni_selection_ms: Int,
    preparation_ms: Int,
    painting_ms: Int,
    exploration_ms: Int,
    reveal_ms: Int,
    /// 鬼が撃つ間隔（issue-27）。前の射撃からこれだけ空かないと、次の申告は無効。
    reload_ms: Int,
  )
}

/// ルームに加わっている CPU。どちらも players に含まれる参加者の ID。
/// strength は鬼 CPU の強さ（鬼 CPU がいないときは使わない）。
pub type Cpus(id) {
  Cpus(hiders: List(id), oni: Option(id), strength: Strength)
}

pub type Game(id) {
  Game(
    phase: Phase,
    /// フェーズの通し番号。タイマーはこの値を持って戻り、古いタイマーを見分ける。
    step: Int,
    durations: Durations,
    /// 参加者（参加順）。鬼選出中の離脱だけがここから外す。
    players: List(id),
    /// 鬼。鬼選出が終わるまで None。鬼は1人固定。
    oni: Option(id),
    positions: Dict(id, Position),
    /// 向き（ラジアン。x 軸から z 軸の向きへ回る）。報告された人だけ持つ（観戦の配信に使う）。
    facings: Dict(id, Float),
    /// まだ隠れている隠れ側（接続中かつ未発見）。
    still_hiding: Set(id),
    /// 鬼選出のカウントダウン中か。エリアへの最初の接触で True になる。
    counting: Bool,
    /// 立候補者（カウント中にエリアへ触れた人）。触れた後はエリアを離れても残る。
    candidates: Set(id),
    /// 開始時に選ばれたステージ（骨格と部屋の割り当て）。
    layout: Layout,
    cpus: Cpus(id),
    /// 準備移動の終わりに確定した、隠れ CPU の状態。
    cpu_states: Dict(id, Placement),
    /// 鬼 CPU が使う見通しの地図（ステージから作っておく）。
    sight_map: sight.Map,
    /// 探索中の鬼 CPU。鬼が CPU のときだけ、探索の開始時に作る。
    oni_cpu: Option(OniCpu),
    /// 直前の tick で鬼 CPU の視界に入っていた隠れ側（見逃しポイント / issue-32 で使う）。
    seen: List(id),
    /// 最後に受け付けた射撃の時刻（ミリ秒。呼び出し側の時計）。撃つ間隔の判定に使う。
    last_shot: Option(Int),
    /// 射撃の判定で見通し（壁）を見るか。ステージの座標が統一される issue-29 まで False。
    shot_sight: Bool,
    /// ステージを移動の規則の入力に写したもの（issue-29a / ADR 0042）。
    grid: Grid,
    /// 開いている襖。issue-29a の間は全部開いている扱い（開閉は issue-29b）。
    open_doors: Set(Edge),
  )
}

// --- 生成 ----------------------------------------------------------------

/// 本番の長さ。探索フェーズだけを指定する。
pub fn durations(exploration_ms exploration_ms: Int) -> Durations {
  Durations(
    oni_selection_ms: oni_selection_ms,
    preparation_ms: preparation_ms,
    painting_ms: painting_ms,
    exploration_ms: exploration_ms,
    reveal_ms: reveal_ms,
    reload_ms: reload_ms,
  )
}

/// 鬼選出フェーズから始める。全員が待機ルームで、鬼希望エリアの外に並ぶ。
/// layout は開始時に選ばれたステージ（stage.generate）。
pub fn new(
  players: List(id),
  durations: Durations,
  layout: Layout,
) -> Game(id) {
  new_with(
    players,
    durations,
    layout,
    Cpus(hiders: [], oni: None, strength: oni_cpu.Normal),
  )
}

/// CPU を加えて始める。cpus の ID は players にも含めておく（参加者として数える）。
pub fn new_with(
  players: List(id),
  durations: Durations,
  layout: Layout,
  cpus: Cpus(id),
) -> Game(id) {
  Game(
    phase: OniSelection,
    step: 0,
    durations:,
    players:,
    oni: None,
    positions: waiting_seats(players),
    facings: dict.new(),
    still_hiding: set.new(),
    counting: False,
    candidates: set.new(),
    layout:,
    cpus:,
    cpu_states: dict.new(),
    sight_map: sight.map_of(layout),
    grid: grid.of_layout(layout),
    open_doors: grid.fusuma(grid.of_layout(layout)),
    oni_cpu: None,
    seen: [],
    last_shot: None,
    shot_sight: False,
  )
}

// --- 問い合わせ -----------------------------------------------------------

/// 今のフェーズの長さ（タイマーを張る時間）。鬼選出はカウント中だけ。終了後は None。
pub fn phase_duration(game: Game(id)) -> Option(Int) {
  case game.phase {
    OniSelection if game.counting -> Some(game.durations.oni_selection_ms)
    OniSelection -> None
    Preparation -> Some(game.durations.preparation_ms)
    Painting -> Some(game.durations.painting_ms)
    Exploration -> Some(game.durations.exploration_ms)
    Reveal(_) -> Some(game.durations.reveal_ms)
    Ended(_) -> None
  }
}

/// 鬼希望エリアの見た目の状態。
pub fn area_state(game: Game(id)) -> AreaState {
  case game.counting, list.length(game.players) >= min_players {
    True, _ -> AreaCounting
    False, True -> AreaReady
    False, False -> AreaWaiting
  }
}

/// まだ隠れている隠れ側の状態（参加順）。探索開始時の一括配信に使う（ADR 0025 / 0035）。
/// 隠れ CPU は確定した状態を持ち、人間はポーズ・ペイントがまだ無いので None（issue-25）。
pub fn hider_states(
  game: Game(id),
) -> List(#(id, Position, Option(Placement))) {
  game.players
  |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
  |> list.map(fn(id) {
    #(
      id,
      position_of(game, id),
      option.from_result(dict.get(game.cpu_states, id)),
    )
  })
}

/// 入室を受け付けるか。鬼選出中（カウント中を含む）だけ。
pub fn accepts_join(game: Game(id)) -> Bool {
  game.phase == OniSelection
}

/// 鬼選出中の入室。待機ルームの空いた席に立つ。それ以外のフェーズと二重の入室は無視する。
pub fn join(game: Game(id), player: id) -> Game(id) {
  case accepts_join(game), list.contains(game.players, player) {
    True, False -> {
      let seat = seat_position(list.length(game.players))
      Game(
        ..game,
        players: list.append(game.players, [player]),
        positions: dict.insert(game.positions, player, seat),
      )
    }
    _, _ -> game
  }
}

// --- 遷移 ----------------------------------------------------------------

/// タイマーの満了。step が今のフェーズと違えば（古いタイマー）何もしない。
/// pick は 0 以上 size 未満の位置を返す乱数（鬼選出で使う）。
pub fn advance(game: Game(id), step: Int, pick: fn(Int) -> Int) -> Game(id) {
  case step == game.step {
    False -> game
    True ->
      case game.phase {
        OniSelection if game.counting -> select_oni(game, pick)
        // カウント前にタイマーは張らないので、届いても何もしない。
        OniSelection -> game
        Preparation -> end_preparation(settle_cpus(game, pick))
        Painting -> start_exploration(game, pick)
        Exploration ->
          case set.is_empty(game.still_hiding) {
            True -> reveal(game, OniWins)
            False -> reveal(game, HidersWin)
          }
        Reveal(outcome) -> end(game, outcome)
        Ended(_) -> game
      }
  }
}

/// 移動の報告（クライアントが報告し、サーバーが制限する）。
/// 待機ルームは円に丸める。ステージは移動の規則（grid / ADR 0042）で、いまの位置から
/// 報告された位置へ動かし、通れない境の手前で止めて滑らせる。準備移動の後の隠れ側、
/// 答え合わせ・終了後は無視する。鬼選出中にエリアへ触れたら touch_area を通る。
pub fn move(game: Game(id), player: id, x: Float, z: Float) -> Game(id) {
  case dict.get(game.positions, player), can_move(game, player) {
    Ok(current), True -> {
      let next = moved_to(game, current, x, z)
      let game =
        Game(..game, positions: dict.insert(game.positions, player, next))
      case game.phase, in_oni_area(next) {
        OniSelection, True -> touch_area(game, player)
        _, _ -> game
      }
    }
    _, _ -> game
  }
}

/// 向きの報告。動ける間だけ受け付ける（観戦者へ送る鬼の向きに使う / issue-28）。
pub fn turn(game: Game(id), player: id, facing: Float) -> Game(id) {
  case can_move(game, player) {
    True -> Game(..game, facings: dict.insert(game.facings, player, facing))
    False -> game
  }
}

/// 発見。探索フェーズ中の、まだ隠れている隠れ側だけが対象。
pub fn found(game: Game(id), player: id) -> Game(id) {
  case game.phase, set.contains(game.still_hiding, player) {
    Exploration, True -> remove_hider(game, player)
    _, _ -> game
  }
}

/// 人間の鬼の射撃の申告（issue-27 / ADR 0022）。now_ms は受け取った時刻（呼び出し側の時計）。
/// 探索フェーズの鬼の申告だけを受け付ける。前の射撃から reload_ms 空いていなければ、申告ごと
/// 無視する（間隔も始め直さない / ADR 0014 の受信順の延長）。受け付けたら、当たり外れに
/// 関わらず、その時刻から次の間隔が始まる。命中なら found（発見）を通る。
pub fn shoot(
  game: Game(id),
  shooter: id,
  target: Option(id),
  now_ms: Int,
) -> Game(id) {
  case game.phase, game.oni == Some(shooter), reloaded(game, now_ms) {
    Exploration, True, True -> {
      let game = Game(..game, last_shot: Some(now_ms))
      case target {
        Some(id) ->
          case hits(game, shooter, id) {
            True -> found(game, id)
            False -> game
          }
        None -> game
      }
    }
    _, _, _ -> game
  }
}

/// 射撃の見通し。襖は開いている扱いで、壁だけが遮る（人間の鬼が開けた襖は、まだサーバーに
/// 届かないため / issue-29）。
pub fn shot_line_clear(
  map: sight.Map,
  from: #(Float, Float),
  to: #(Float, Float),
) -> Bool {
  sight.line_of_sight(map, set.from_list(sight.doors(map)), from, to)
}

fn reloaded(game: Game(id), now_ms: Int) -> Bool {
  case game.last_shot {
    None -> True
    Some(last) -> now_ms - last >= game.durations.reload_ms
  }
}

/// 命中か。狙った相手がまだ隠れていて、2人ともステージにいて、射程の内側で、（有効なら）
/// 見通しが通ること。
fn hits(game: Game(id), oni: id, target: id) -> Bool {
  case
    set.contains(game.still_hiding, target),
    dict.get(game.positions, oni),
    dict.get(game.positions, target)
  {
    True, Ok(Position(Stage, ox, oz)), Ok(Position(Stage, tx, tz)) -> {
      let dx = tx -. ox
      let dz = tz -. oz
      let in_range = dx *. dx +. dz *. dz <=. shot_range *. shot_range
      in_range
      && {
        !game.shot_sight
        || shot_line_clear(game.sight_map, #(ox, oz), #(tx, tz))
      }
    }
    _, _, _ -> False
  }
}

/// 離脱の確定（再接続猶予を過ぎた切断 / ADR 0013）。
/// 鬼の離脱は即座に隠れ側の勝利。隠れ側の離脱は発見と同じ remove_hider を通る。
/// 鬼選出中は参加者・立候補者から外すだけで、カウントは止めない（ADR 0024）。
/// 答え合わせ・終了後は勝敗が決まっているので何もしない。
pub fn leave(game: Game(id), player: id) -> Game(id) {
  case game.phase, game.oni {
    Ended(_), _ | Reveal(_), _ -> game
    OniSelection, _ ->
      Game(
        ..game,
        players: list.filter(game.players, fn(id) { id != player }),
        positions: dict.delete(game.positions, player),
        candidates: set.delete(game.candidates, player),
      )
    _, Some(oni) if oni == player -> reveal(game, HidersWin)
    _, _ -> remove_hider(game, player)
  }
}

// --- 内部 ----------------------------------------------------------------

/// 「まだ隠れている」集合から外す。発見・切断・被りによる失格の唯一の合流点。
/// 集合が0人になった時点で鬼の勝利とし、答え合わせへ進む。
fn remove_hider(game: Game(id), player: id) -> Game(id) {
  let still_hiding = set.delete(game.still_hiding, player)
  let game = Game(..game, still_hiding:)
  case set.is_empty(still_hiding) {
    True -> reveal(game, OniWins)
    False -> game
  }
}

/// 鬼希望エリアに触れた。カウント中なら立候補者に加える。カウント前で2人以上なら、
/// 触れた本人を立候補者にしてカウントダウンを始める（step を進めてタイマーを張らせる）。
/// 2人未満なら何もしない。
fn touch_area(game: Game(id), player: id) -> Game(id) {
  case area_state(game) {
    AreaCounting ->
      Game(..game, candidates: set.insert(game.candidates, player))
    AreaReady ->
      Game(
        ..game,
        counting: True,
        candidates: set.from_list([player]),
        step: game.step + 1,
      )
    AreaWaiting -> game
  }
}

/// 立候補者（残っている人）がいればその中から、いなければ全員から、鬼を1人選ぶ。
/// 隠れ側はステージへ移り、鬼は待機ルームに残る。2人未満なら不成立。
/// 鬼 CPU がいれば、抽選をせずにその CPU を鬼にする。隠れ側 CPU は抽選の対象にしない。
fn select_oni(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let humans =
    list.filter(game.players, fn(id) { !list.contains(game.cpus.hiders, id) })
  let pool = case
    list.filter(humans, fn(id) { set.contains(game.candidates, id) })
  {
    [] -> humans
    some -> some
  }
  let chosen = case game.cpus.oni {
    Some(cpu) ->
      case list.contains(game.players, cpu) {
        True -> Ok(cpu)
        False -> nth(pool, pick(list.length(pool)))
      }
    None -> nth(pool, pick(list.length(pool)))
  }
  case list.length(game.players) < min_players, chosen {
    False, Ok(oni) -> {
      let hiders = list.filter(game.players, fn(id) { id != oni })
      // 隠れ側は全員、玄関に現れる（ADR 0032）。重ならないよう動くのは本人たち。
      let positions =
        hiders
        |> list.map(fn(id) { #(id, spawn_position(game)) })
        |> dict.from_list
        |> dict.insert(oni, position_of(game, oni))
      Game(
        ..next(game, Preparation),
        oni: Some(oni),
        positions:,
        still_hiding: set.from_list(hiders),
        counting: False,
      )
    }
    // 不成立は答え合わせを挟まずに終了する。
    _, _ -> end(game, NotEnoughPlayers)
  }
}

/// 準備移動の終わり。全員の座標が確定したこの瞬間に被りを判定し、球が重なっていた
/// 隠れ側を失格にしてからペイントへ進む。失格で誰もいなくなれば、その時点で鬼の勝利。
fn end_preparation(game: Game(id)) -> Game(id) {
  let hiders =
    game.still_hiding
    |> set.to_list
    |> list.filter_map(fn(id) {
      case dict.get(game.positions, id) {
        Ok(Position(Stage, x, z)) -> Ok(#(id, x, z))
        _ -> Error(Nil)
      }
    })
  let judged =
    overlap.overlapping(hiders)
    |> set.to_list
    |> list.fold(game, remove_hider)
  case judged.phase {
    Preparation -> next(judged, Painting)
    _ -> judged
  }
}

/// 準備移動の終わりに、まだ隠れている隠れ CPU の位置・ポーズ・ペイントを確定させる。
/// 人間の隠れ側の今の位置とも、CPU どうしとも被らないマスに置く（被り判定の直前）。
fn settle_cpus(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let #(cpus, humans) =
    game.players
    |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
    |> list.partition(fn(id) { list.contains(game.cpus.hiders, id) })
  case cpus {
    [] -> game
    _ -> {
      let occupied =
        list.filter_map(humans, fn(id) {
          case dict.get(game.positions, id) {
            Ok(Position(Stage, x, z)) -> Ok(#(x, z))
            _ -> Error(Nil)
          }
        })
      let placed =
        hider_cpu.place(
          game.layout,
          occupied,
          list.length(cpus),
          pick(cpu_seed_range),
        )
      list.zip(cpus, placed)
      |> list.fold(game, fn(game, pair) {
        let #(id, p) = pair
        Game(
          ..game,
          positions: dict.insert(game.positions, id, Position(Stage, p.x, p.z)),
          cpu_states: dict.insert(game.cpu_states, id, p),
        )
      })
    }
  }
}

/// 鬼が待機ルームからステージへ移り、探索を始める。鬼 CPU は玄関から出る。
fn start_exploration(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  case game.oni, game.cpus.oni {
    Some(oni), Some(cpu) if oni == cpu -> {
      let walker =
        oni_cpu.start(game.layout, game.cpus.strength, pick(cpu_seed_range))
      let #(x, z) = walker.position
      Game(
        ..next(game, Exploration),
        positions: dict.insert(game.positions, oni, Position(Stage, x, z)),
        oni_cpu: Some(walker),
      )
    }
    Some(oni), _ ->
      Game(
        ..next(game, Exploration),
        positions: dict.insert(game.positions, oni, spawn_position(game)),
      )
    None, _ -> next(game, Exploration)
  }
}

/// 探索中に鬼 CPU が動いているか（0.5秒ごとの tick が要るか）。
pub fn oni_cpu_active(game: Game(id)) -> Bool {
  game.phase == Exploration && option.is_some(game.oni_cpu)
}

/// 鬼 CPU の 0.5秒ぶん。歩いて、視界に入った隠れ側に発見の乱数を引く。見つけた隠れ側は
/// found（人間の鬼が当てたときと同じ処理）で抜ける。探索中でなければ何もしない。
pub fn tick(game: Game(id)) -> Game(id) {
  case game.phase, game.oni_cpu, game.oni {
    Exploration, Some(walker), Some(oni) -> {
      let hiders =
        game.players
        |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
        |> list.filter_map(fn(id) {
          case dict.get(game.positions, id) {
            Ok(Position(Stage, x, z)) -> {
              let color = case dict.get(game.cpu_states, id) {
                Ok(placement) -> placement.color
                // 人間のペイントはまだ無い（issue-25）。塗っていない体の色で数える。
                Error(Nil) -> palette.unpainted
              }
              Ok(oni_cpu.Hider(id:, x:, z:, color:))
            }
            _ -> Error(Nil)
          }
        })
      let #(walker, found_ids, seen) =
        oni_cpu.step(walker, game.sight_map, game.layout, hiders)
      let #(x, z) = walker.position
      let moved =
        Game(
          ..game,
          oni_cpu: Some(walker),
          seen:,
          positions: dict.insert(game.positions, oni, Position(Stage, x, z)),
        )
      list.fold(found_ids, moved, found)
    }
    _, _, _ -> game
  }
}

/// 動けるか。準備移動の後（ペイント・探索）は鬼だけ。答え合わせ・終了後は誰も動けない。
fn can_move(game: Game(id), player: id) -> Bool {
  case game.phase {
    Ended(_) | Reveal(_) -> False
    Painting | Exploration -> game.oni == Some(player)
    OniSelection | Preparation -> True
  }
}

fn in_oni_area(position: Position) -> Bool {
  case position {
    Position(WaitingRoom, x, z) ->
      x *. x +. z *. z <=. oni_area_radius *. oni_area_radius
    _ -> False
  }
}

/// 報告された位置へ動かした結果。待機ルームは半径 waiting_room_radius の円に丸め、ステージは
/// 移動の規則で、いまの位置から動かす。
fn moved_to(game: Game(id), current: Position, x: Float, z: Float) -> Position {
  case current.space {
    WaitingRoom -> {
      let distance = sqrt(x *. x +. z *. z)
      case distance >. waiting_room_radius {
        True -> {
          let scale = waiting_room_radius /. distance
          Position(WaitingRoom, x *. scale, z *. scale)
        }
        False -> Position(WaitingRoom, x, z)
      }
    }
    Stage -> {
      let #(nx, nz) =
        grid.step(game.grid, game.open_doors, #(current.x, current.z), #(x, z))
      Position(Stage, nx, nz)
    }
  }
}

/// 玄関（骨格の spawn）。鬼と隠れ側のリスポーン位置（ADR 0032）。
fn spawn_position(game: Game(id)) -> Position {
  let #(x, z) = game.layout.skeleton.spawn
  Position(Stage, x, z)
}

fn next(game: Game(id), phase: Phase) -> Game(id) {
  Game(..game, phase:, step: game.step + 1)
}

/// 勝敗が決まった。答え合わせタイムへ進む。
fn reveal(game: Game(id), outcome: Outcome) -> Game(id) {
  next(game, Reveal(outcome))
}

fn end(game: Game(id), outcome: Outcome) -> Game(id) {
  next(game, Ended(outcome))
}

fn position_of(game: Game(id), id: id) -> Position {
  case dict.get(game.positions, id) {
    Ok(p) -> p
    Error(Nil) -> Position(WaitingRoom, 0.0, 0.0)
  }
}

fn nth(items: List(a), index: Int) -> Result(a, Nil) {
  case index < 0 {
    True -> Error(Nil)
    False ->
      items
      |> list.drop(index)
      |> list.first
  }
}

/// 待機ルームの席（定員5人分の輪）に、参加順で並べる。
fn waiting_seats(ids: List(id)) -> Dict(id, Position) {
  ids
  |> list.index_map(fn(id, index) { #(id, seat_position(index)) })
  |> dict.from_list
}

fn seat_position(index: Int) -> Position {
  let angle =
    2.0 *. pi *. int.to_float(index) /. int.to_float(waiting_ring_seats)
  Position(
    WaitingRoom,
    waiting_ring_radius *. cos(angle),
    waiting_ring_radius *. sin(angle),
  )
}

const pi = 3.141592653589793

@external(erlang, "math", "cos")
fn cos(x: Float) -> Float

@external(erlang, "math", "sin")
fn sin(x: Float) -> Float

@external(erlang, "math", "sqrt")
fn sqrt(x: Float) -> Float
