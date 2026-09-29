/// veryare の進行（ADR 0024）を表す純粋な状態機械。
///
/// フェーズは 鬼選出 → 準備移動 → ペイント → 探索 → 終了 の順に、タイマーの満了で
/// 進む。時刻と乱数は外から渡し（advance の step と pick）、ここはプロセスも時計も
/// 持たない。ルームへの載せ方は games/veryare/room.gleam が受け持つ。
///
/// 「まだ隠れている」集合（still_hiding）は、接続中かつ未発見の隠れ側と定義する。
/// 発見（found）と、猶予を過ぎた切断（leave）は、どちらも remove_hider だけを通って
/// この集合から抜ける。個別の分岐を持たないので、結果の状態は完全に一致する。
import gleam/dict.{type Dict}
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/set.{type Set}

// --- 定数 ----------------------------------------------------------------

/// 鬼選出フェーズの長さ（ミリ秒）。
pub const oni_selection_ms = 10_000

/// 準備移動フェーズの長さ（ミリ秒）。
pub const preparation_ms = 20_000

/// ペイントフェーズの長さ（ミリ秒）。
pub const painting_ms = 20_000

/// 待機ルームの半幅（メートル）。約3.6m四方（8畳）の部屋を中心から ±1.8m で表す。
pub const waiting_room_half = 1.8

/// 鬼希望エリア（待機ルーム中央の円）の半径（メートル）。
pub const oni_area_radius = 0.6

/// ステージの半幅（メートル）。issue-29 で作り込むまでの仮の広さ。
pub const stage_half = 5.0

/// 開始時に待機ルームで並ぶ輪の半径。鬼希望エリアの外に置き、立候補は自分で入った人だけにする。
const waiting_ring_radius = 1.3

/// 鬼選出後、隠れ側がステージで並ぶ輪の半径。
const stage_ring_radius = 3.0

// --- 型 ------------------------------------------------------------------

/// 勝敗。NotEnoughPlayers は鬼選出の時点で2人未満だったときの不成立。
pub type Outcome {
  OniWins
  HidersWin
  NotEnoughPlayers
}

/// フェーズ（ADR 0024）。Ended は終了/観戦。
pub type Phase {
  OniSelection
  Preparation
  Painting
  Exploration
  Ended(outcome: Outcome)
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
  )
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
    /// まだ隠れている隠れ側（接続中かつ未発見）。
    still_hiding: Set(id),
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
  )
}

/// 鬼選出フェーズから始める。全員が待機ルームで、鬼希望エリアの外に並ぶ。
pub fn new(players: List(id), durations: Durations) -> Game(id) {
  Game(
    phase: OniSelection,
    step: 0,
    durations:,
    players:,
    oni: None,
    positions: ring(players, WaitingRoom, waiting_ring_radius),
    still_hiding: set.new(),
  )
}

// --- 問い合わせ -----------------------------------------------------------

/// 今のフェーズの長さ。終了後は None（タイマーを張らない）。
pub fn phase_duration(game: Game(id)) -> Option(Int) {
  case game.phase {
    OniSelection -> Some(game.durations.oni_selection_ms)
    Preparation -> Some(game.durations.preparation_ms)
    Painting -> Some(game.durations.painting_ms)
    Exploration -> Some(game.durations.exploration_ms)
    Ended(_) -> None
  }
}

/// 鬼希望エリアにいる立候補者（参加順）。
pub fn candidates(game: Game(id)) -> List(id) {
  list.filter(game.players, fn(id) {
    case dict.get(game.positions, id) {
      Ok(Position(WaitingRoom, x, z)) ->
        x *. x +. z *. z <=. oni_area_radius *. oni_area_radius
      _ -> False
    }
  })
}

// --- 遷移 ----------------------------------------------------------------

/// タイマーの満了。step が今のフェーズと違えば（古いタイマー）何もしない。
/// pick は 0 以上 size 未満の位置を返す乱数（鬼選出で使う）。
pub fn advance(game: Game(id), step: Int, pick: fn(Int) -> Int) -> Game(id) {
  case step == game.step {
    False -> game
    True ->
      case game.phase {
        OniSelection -> select_oni(game, pick)
        Preparation -> next(game, Painting)
        Painting -> start_exploration(game)
        Exploration ->
          case set.is_empty(game.still_hiding) {
            True -> end(game, OniWins)
            False -> end(game, HidersWin)
          }
        Ended(_) -> game
      }
  }
}

/// 移動の報告（クライアントが報告し、サーバーが制限する）。
/// いまいる空間の範囲に丸める。探索フェーズ中の隠れ側と、終了後は無視する。
pub fn move(game: Game(id), player: id, x: Float, z: Float) -> Game(id) {
  case dict.get(game.positions, player), can_move(game, player) {
    Ok(current), True -> {
      let half = half_width(current.space)
      let next =
        Position(
          current.space,
          float.clamp(x, 0.0 -. half, half),
          float.clamp(z, 0.0 -. half, half),
        )
      Game(..game, positions: dict.insert(game.positions, player, next))
    }
    _, _ -> game
  }
}

/// 発見。探索フェーズ中の、まだ隠れている隠れ側だけが対象。
pub fn found(game: Game(id), player: id) -> Game(id) {
  case game.phase, set.contains(game.still_hiding, player) {
    Exploration, True -> remove_hider(game, player)
    _, _ -> game
  }
}

/// 離脱の確定（再接続猶予を過ぎた切断 / ADR 0013）。
/// 鬼の離脱は即座に隠れ側の勝利。隠れ側の離脱は発見と同じ remove_hider を通る。
pub fn leave(game: Game(id), player: id) -> Game(id) {
  case game.phase, game.oni {
    Ended(_), _ -> game
    OniSelection, _ ->
      Game(
        ..game,
        players: list.filter(game.players, fn(id) { id != player }),
        positions: dict.delete(game.positions, player),
      )
    _, Some(oni) if oni == player -> end(game, HidersWin)
    _, _ -> remove_hider(game, player)
  }
}

// --- 内部 ----------------------------------------------------------------

/// 「まだ隠れている」集合から外す。発見と切断の唯一の合流点。
/// 集合が0人になった時点で鬼の勝利とする。
fn remove_hider(game: Game(id), player: id) -> Game(id) {
  let still_hiding = set.delete(game.still_hiding, player)
  let game = Game(..game, still_hiding:)
  case set.is_empty(still_hiding) {
    True -> end(game, OniWins)
    False -> game
  }
}

/// 立候補者がいればその中から、いなければ全員から、鬼を1人選ぶ。
/// 隠れ側はステージへ移り、鬼は待機ルームに残る。
fn select_oni(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let pool = case candidates(game) {
    [] -> game.players
    some -> some
  }
  case list.length(game.players) < 2, nth(pool, pick(list.length(pool))) {
    False, Ok(oni) -> {
      let hiders = list.filter(game.players, fn(id) { id != oni })
      let positions =
        ring(hiders, Stage, stage_ring_radius)
        |> dict.insert(oni, position_of(game, oni))
      Game(
        ..next(game, Preparation),
        oni: Some(oni),
        positions:,
        still_hiding: set.from_list(hiders),
      )
    }
    _, _ -> end(game, NotEnoughPlayers)
  }
}

/// 鬼が待機ルームからステージへ移り、探索を始める。
fn start_exploration(game: Game(id)) -> Game(id) {
  let positions = case game.oni {
    Some(oni) ->
      dict.insert(game.positions, oni, Position(Stage, 0.0, stage_half -. 0.5))
    None -> game.positions
  }
  Game(..next(game, Exploration), positions:)
}

fn can_move(game: Game(id), player: id) -> Bool {
  case game.phase {
    Ended(_) -> False
    Exploration -> game.oni == Some(player)
    _ -> True
  }
}

fn half_width(space: Space) -> Float {
  case space {
    WaitingRoom -> waiting_room_half
    Stage -> stage_half
  }
}

fn next(game: Game(id), phase: Phase) -> Game(id) {
  Game(..game, phase:, step: game.step + 1)
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

/// 中心の周りに等間隔で並べる。
fn ring(ids: List(id), space: Space, radius: Float) -> Dict(id, Position) {
  let count = int.to_float(int.max(list.length(ids), 1))
  ids
  |> list.index_map(fn(id, index) {
    let angle = 2.0 *. pi *. int.to_float(index) /. count
    #(id, Position(space, radius *. cos(angle), radius *. sin(angle)))
  })
  |> dict.from_list
}

const pi = 3.141592653589793

@external(erlang, "math", "cos")
fn cos(x: Float) -> Float

@external(erlang, "math", "sin")
fn sin(x: Float) -> Float
