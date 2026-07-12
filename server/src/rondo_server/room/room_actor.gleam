import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/option.{type Option, None, Some}
import gleam/otp/actor
import rondo_server/room/authority.{type Authority, type Outcome}

/// ルームを一意に識別するID。ロビーがルーム一覧で扱う単位（ADR 0016）。
pub type RoomId {
  RoomId(String)
}

/// プレイヤーを識別するID。Phase 1 は永続アカウントを持たず、
/// 端末保持の表示名で名乗る（ADR 0015）。
pub type PlayerId {
  PlayerId(String)
}

/// ルーム内のプレイヤー。name は端末保持の表示名（ADR 0015）。
pub type Player {
  Player(id: PlayerId, name: String)
}

/// サーバー権威の箱を作る関数（ADR 0008）。開始時に参加者を渡して初期化する。
/// 権威を必要としないゲームは None。
pub type AuthorityFactory =
  fn(List(PlayerId)) -> Authority(PlayerId)

/// ルーム生成時の設定。room_supervisor がこの値を引数にルームを起こす。
pub type RoomSpec {
  RoomSpec(
    id: RoomId,
    min_players: Int,
    max_players: Int,
    authority: Option(AuthorityFactory),
  )
}

/// ルームの生存段階。ルームは「作る → 遊ぶ → 終わる → 解散」で単純に閉じる（ADR 0017）。
pub type Status {
  /// 参加受付中。ゲーム開始前。
  Open
  /// ゲーム進行中。この間だけ最小人数割れの判定が働く（ADR 0013）。
  Playing
  /// ゲームが終了し、結果が確定した。解散（プロセス終了）は別ステップ（配信後 / issue-14）。
  Finished
}

/// 参加が断られる理由。
pub type JoinError {
  /// 定員に達している。
  RoomFull
  /// 既に参加済み。
  AlreadyJoined
  /// ゲームが始まっており、途中参加はできない。
  GameAlreadyStarted
}

/// ゲーム開始が断られる理由。
pub type StartGameError {
  /// 最小人数に満たない。
  NotEnoughPlayers
  /// 既に開始済み、または終了済み。
  AlreadyPlaying
}

/// ルームの外向きスナップショット（監視・テスト用）。内部辞書は晒さない。
pub type RoomState {
  RoomState(
    id: RoomId,
    status: Status,
    players: List(Player),
    min_players: Int,
    max_players: Int,
    /// 確定した結果。Finished のときだけ Some（ADR 0014）。
    result: Option(Outcome(PlayerId)),
  )
}

/// ルームアクターが受け取るメッセージ。
pub type Message {
  /// 参加する。定員・重複・開始済みを判定して可否を返す。
  Join(player: Player, reply: Subject(Result(Nil, JoinError)))
  /// 離脱を確定する。再接続猶予を過ぎた離脱としてルームが受ける（ADR 0013）。
  Leave(player: PlayerId)
  /// ゲームを開始する。最小人数を満たしていれば Playing へ移り、権威を初期化する。
  StartGame(reply: Subject(Result(Nil, StartGameError)))
  /// ゲーム内イベント（ゴール到達等）。権威が受信順に処理する（ADR 0008 / 0014）。
  GameEvent(player: PlayerId, payload: Dynamic)
  /// 現在の状態を問い合わせる（監視・テスト用）。
  Snapshot(reply: Subject(RoomState))
  /// ルームを明示的に解散する。
  Dissolve
}

type State {
  State(
    spec: RoomSpec,
    status: Status,
    players: Dict(PlayerId, Player),
    /// 進行中のゲーム権威。開始時に spec.authority から作る。
    authority: Option(Authority(PlayerId)),
    /// 確定した結果。
    result: Option(Outcome(PlayerId)),
  )
}

/// ルームアクターを起動する。room_supervisor の子テンプレートとして呼ばれる。
/// 戻り値の Started.data がこのルームへ送るための Subject。
pub fn start(spec: RoomSpec) -> actor.StartResult(Subject(Message)) {
  actor.new(State(
    spec:,
    status: Open,
    players: dict.new(),
    authority: None,
    result: None,
  ))
  |> actor.on_message(handle)
  |> actor.start
}

/// 参加する。
pub fn join(room: Subject(Message), player: Player) -> Result(Nil, JoinError) {
  process.call(room, 1000, Join(player, _))
}

/// 離脱を確定する。
pub fn leave(room: Subject(Message), player: PlayerId) -> Nil {
  process.send(room, Leave(player))
}

/// ゲームを開始する。
pub fn start_game(room: Subject(Message)) -> Result(Nil, StartGameError) {
  process.call(room, 1000, StartGame)
}

/// ゲーム内イベントを送る。権威が受信順に処理する（ADR 0014）。
pub fn game_event(
  room: Subject(Message),
  player: PlayerId,
  payload: Dynamic,
) -> Nil {
  process.send(room, GameEvent(player, payload))
}

/// 現在の状態を問い合わせる。
pub fn snapshot(room: Subject(Message)) -> RoomState {
  process.call(room, 1000, Snapshot)
}

/// ルームを解散する。
pub fn dissolve(room: Subject(Message)) -> Nil {
  process.send(room, Dissolve)
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Join(player, reply) -> handle_join(state, player, reply)

    Leave(player) -> handle_leave(state, player)

    StartGame(reply) -> handle_start_game(state, reply)

    GameEvent(player, payload) -> handle_game_event(state, player, payload)

    Snapshot(reply) -> {
      process.send(reply, to_state(state))
      actor.continue(state)
    }

    Dissolve -> actor.stop()
  }
}

fn handle_join(
  state: State,
  player: Player,
  reply: Subject(Result(Nil, JoinError)),
) -> actor.Next(State, Message) {
  let already_joined = dict.has_key(state.players, player.id)
  let full = dict.size(state.players) >= state.spec.max_players

  case state.status, already_joined, full {
    Open, False, False -> {
      process.send(reply, Ok(Nil))
      actor.continue(
        State(..state, players: dict.insert(state.players, player.id, player)),
      )
    }
    Open, True, _ -> {
      process.send(reply, Error(AlreadyJoined))
      actor.continue(state)
    }
    Open, False, True -> {
      process.send(reply, Error(RoomFull))
      actor.continue(state)
    }
    // 開始後・終了後は途中参加できない。
    _, _, _ -> {
      process.send(reply, Error(GameAlreadyStarted))
      actor.continue(state)
    }
  }
}

fn handle_start_game(
  state: State,
  reply: Subject(Result(Nil, StartGameError)),
) -> actor.Next(State, Message) {
  case state.status, dict.size(state.players) >= state.spec.min_players {
    Open, True -> {
      process.send(reply, Ok(Nil))
      let authority = case state.spec.authority {
        Some(factory) -> Some(factory(dict.keys(state.players)))
        None -> None
      }
      actor.continue(State(..state, status: Playing, authority:))
    }
    Open, False -> {
      process.send(reply, Error(NotEnoughPlayers))
      actor.continue(state)
    }
    // Playing / Finished はすでに開始済み。
    _, _ -> {
      process.send(reply, Error(AlreadyPlaying))
      actor.continue(state)
    }
  }
}

/// ゲーム内イベントを権威に流す。終了したら結果を確定して Finished に移る。
/// 権威が受信した順が順位になる（ADR 0014）。解散は配信後の別ステップ（issue-14）。
fn handle_game_event(
  state: State,
  player: PlayerId,
  payload: Dynamic,
) -> actor.Next(State, Message) {
  case state.status, state.authority {
    Playing, Some(current) -> {
      let updated = authority.record(current, player, payload)
      case authority.is_over(updated) {
        True ->
          actor.continue(
            State(
              ..state,
              status: Finished,
              authority: Some(updated),
              result: Some(authority.outcome(updated)),
            ),
          )
        False -> actor.continue(State(..state, authority: Some(updated)))
      }
    }
    // 開始前・終了後・権威なしは無視する。
    _, _ -> actor.continue(state)
  }
}

fn handle_leave(state: State, player: PlayerId) -> actor.Next(State, Message) {
  let players = dict.delete(state.players, player)
  let remaining = dict.size(players)
  let below_min = remaining < state.spec.min_players

  case remaining, state.status, below_min {
    // 誰も残らなければ解散する。
    0, _, _ -> actor.stop()
    // 進行中に最小人数を下回ったらゲームを終了し、ルームを解散する（ADR 0013 / 0017）。
    _, Playing, True -> actor.stop()
    // それ以外は在室のまま続ける（開始前・終了後は最小人数を下回っていてよい）。
    _, _, _ -> actor.continue(State(..state, players:))
  }
}

fn to_state(state: State) -> RoomState {
  RoomState(
    id: state.spec.id,
    status: state.status,
    players: dict.values(state.players),
    min_players: state.spec.min_players,
    max_players: state.spec.max_players,
    result: state.result,
  )
}
