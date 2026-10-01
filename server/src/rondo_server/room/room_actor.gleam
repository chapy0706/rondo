import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/otp/actor
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/authority.{type Authority, type Outcome}
import rondo_server/room/driver.{type Driver, type Effect}

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

/// ゲーム進行の差し込み口（room/driver）を作る関数。開始時に参加者を渡し、
/// 箱と最初の指示（タイマー・配信）を受け取る。時間経過や離脱で勝敗が決まる
/// ゲーム（veryare 等）が使う。使わないゲームは None。
pub type DriverFactory =
  fn(List(PlayerId)) -> #(Driver(PlayerId), List(Effect(PlayerId)))

/// ルーム生成時の設定。room_supervisor がこの値を引数にルームを起こす。
pub type RoomSpec {
  RoomSpec(
    id: RoomId,
    /// ゲーム種別。マニフェストの id と対応し、電文の gameType になる（ADR 0007）。
    game_type: String,
    min_players: Int,
    max_players: Int,
    authority: Option(AuthorityFactory),
    /// ゲーム進行の差し込み口。Some のゲームでは、進行中の離脱の扱いもゲームに委ねる。
    driver: Option(DriverFactory),
    /// 入室後に初めて分かる案内（探索時間など / ADR 0024）。参加者が送信先を登録した
    /// ときにだけ送り、ルーム一覧には出さない。
    member_info: Option(Dynamic),
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
    /// ルームを作ったプレイヤー（最初の参加者）。抜けてもルームは続く（ADR 0030）。
    host: Option(PlayerId),
  )
}

/// ルームアクターが受け取るメッセージ。
pub type Message {
  /// 参加する。定員・重複・開始済みを判定して可否を返す。差し込み口を持つゲームは、
  /// ゲームが受け付ける間（veryare の鬼選出中）は進行中でも参加できる。
  Join(player: Player, reply: Subject(Result(Nil, JoinError)))
  /// 離脱を確定する。再接続猶予を過ぎた離脱としてルームが受ける（ADR 0013）。
  Leave(player: PlayerId)
  /// ゲームを開始する。最小人数を満たしていれば Playing へ移り、権威を初期化する。
  StartGame(reply: Subject(Result(Nil, StartGameError)))
  /// ゲーム内イベント（ゴール到達等）。権威が受信順に処理する（ADR 0008 / 0014）。
  GameEvent(player: PlayerId, payload: Dynamic)
  /// 参加者の送信先（接続への出口）を登録する。参加者でなければ無視する。
  /// 登録し直すと置き換わる（再接続 / ADR 0013）。
  Subscribe(player: PlayerId, outbox: Subject(ServerMessage))
  /// 宛先のプレイヤーにだけ限定配信を送る（ADR 0021）。宛先でない接続には送らない。
  /// 誰に送るかの判断は呼び出し側（ゲームごとのサーバー権威 / ADR 0008）が持つ。
  SendTo(targets: List(PlayerId), payload: Dynamic)
  /// 現在の状態を問い合わせる（監視・テスト用）。
  Snapshot(reply: Subject(RoomState))
  /// ルームを明示的に解散する。
  Dissolve
  /// ゲームが WakeAfter で頼んだタイマーの満了（内部用）。
  Wake(token: Int)
}

type State {
  State(
    /// 自分自身への Subject。ゲームが頼んだタイマーの送り先に使う。
    self: Subject(Message),
    spec: RoomSpec,
    status: Status,
    players: Dict(PlayerId, Player),
    /// 参加者ごとの送信先。限定配信はここに登録された宛先にだけ送る。
    outboxes: Dict(PlayerId, Subject(ServerMessage)),
    /// 進行中のゲーム権威。開始時に spec.authority から作る。
    authority: Option(Authority(PlayerId)),
    /// 確定した結果。
    result: Option(Outcome(PlayerId)),
    /// 進行中のゲーム進行の箱。開始時に spec.driver から作る。
    driver: Option(Driver(PlayerId)),
    /// ルームを作ったプレイヤー（最初の参加者）。
    host: Option(PlayerId),
  )
}

/// ルームアクターを起動する。room_supervisor の子テンプレートとして呼ばれる。
/// 戻り値の Started.data がこのルームへ送るための Subject。
pub fn start(spec: RoomSpec) -> actor.StartResult(Subject(Message)) {
  actor.new_with_initialiser(1000, fn(self) {
    State(
      self:,
      spec:,
      status: Open,
      players: dict.new(),
      outboxes: dict.new(),
      authority: None,
      result: None,
      driver: None,
      host: None,
    )
    |> actor.initialised
    |> actor.returning(self)
    |> Ok
  })
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

/// 参加者の送信先を登録する。参加者でなければ無視される。
pub fn subscribe(
  room: Subject(Message),
  player: PlayerId,
  outbox: Subject(ServerMessage),
) -> Nil {
  process.send(room, Subscribe(player, outbox))
}

/// 宛先のプレイヤーにだけ限定配信を送る（ADR 0021）。
pub fn send_to(
  room: Subject(Message),
  targets: List(PlayerId),
  payload: Dynamic,
) -> Nil {
  process.send(room, SendTo(targets, payload))
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

    Subscribe(player, outbox) -> handle_subscribe(state, player, outbox)

    SendTo(targets, payload) -> {
      deliver_to(state, targets, payload)
      actor.continue(state)
    }

    Wake(token) ->
      case state.status, state.driver {
        Playing, Some(current) -> run_driver(state, driver.wake(current, token))
        _, _ -> actor.continue(state)
      }

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

  let driver_accepts = case state.status, state.driver {
    Playing, Some(current) -> driver.accepts_join(current)
    _, _ -> False
  }

  case state.status, already_joined, full {
    Playing, False, False if driver_accepts -> {
      process.send(reply, Ok(Nil))
      let assert Some(current) = state.driver
      run_driver(
        State(..state, players: dict.insert(state.players, player.id, player)),
        driver.join(current, player.id),
      )
    }
    Playing, True, _ if driver_accepts -> {
      process.send(reply, Error(AlreadyJoined))
      actor.continue(state)
    }
    Playing, False, True if driver_accepts -> {
      process.send(reply, Error(RoomFull))
      actor.continue(state)
    }
    Open, False, False -> {
      process.send(reply, Ok(Nil))
      let host = case state.host {
        None -> Some(player.id)
        some -> some
      }
      actor.continue(
        State(
          ..state,
          players: dict.insert(state.players, player.id, player),
          host:,
        ),
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
  // 差し込み口を持つゲームは人数の扱い（開始・成立の判定）をゲームに委ね、1人から始められる。
  let enough = case state.spec.driver {
    Some(_) -> dict.size(state.players) >= 1
    None -> dict.size(state.players) >= state.spec.min_players
  }
  case state.status, enough {
    Open, True -> {
      process.send(reply, Ok(Nil))
      let authority = case state.spec.authority {
        Some(factory) -> Some(factory(dict.keys(state.players)))
        None -> None
      }
      let state = State(..state, status: Playing, authority:)
      case state.spec.driver {
        Some(factory) -> run_driver(state, factory(dict.keys(state.players)))
        None -> actor.continue(state)
      }
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
  case state.status, state.driver, state.authority {
    Playing, Some(current), _ ->
      run_driver(state, driver.event(current, player, payload))
    Playing, None, Some(current) -> {
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
    _, _, _ -> actor.continue(state)
  }
}

fn handle_subscribe(
  state: State,
  player: PlayerId,
  outbox: Subject(ServerMessage),
) -> actor.Next(State, Message) {
  case dict.has_key(state.players, player) {
    True -> {
      case state.spec.member_info {
        Some(info) -> process.send(outbox, game_state(state, info))
        None -> Nil
      }
      actor.continue(
        State(..state, outboxes: dict.insert(state.outboxes, player, outbox)),
      )
    }
    // 参加者でない接続には送信先を持たせない（情報が漏れる経路を作らない）。
    False -> actor.continue(state)
  }
}

/// 宛先ごとに1通ずつ送る。to には受け取る本人の ID だけを載せ、他の宛先を漏らさない。
/// 宛先でない接続・送信先が未登録の宛先には何も送らない。
fn deliver_to(state: State, targets: List(PlayerId), payload: Dynamic) -> Nil {
  let RoomId(room_id) = state.spec.id
  targets
  |> list.unique
  |> list.each(fn(target) {
    case dict.get(state.outboxes, target) {
      Ok(outbox) -> {
        let PlayerId(to) = target
        process.send(
          outbox,
          GameStateTo(game_type: state.spec.game_type, room_id:, to:, payload:),
        )
      }
      Error(Nil) -> Nil
    }
  })
}

fn handle_leave(state: State, player: PlayerId) -> actor.Next(State, Message) {
  let players = dict.delete(state.players, player)
  let outboxes = dict.delete(state.outboxes, player)
  let remaining = dict.size(players)
  let below_min = remaining < state.spec.min_players

  let state = State(..state, players:, outboxes:)

  case remaining, state.status, below_min, state.driver {
    // 誰も残らなければ解散する。
    0, _, _, _ -> actor.stop()
    // ゲーム進行の差し込み口があるゲームは、進行中の離脱の扱い（勝敗）をゲームに委ねる。
    _, Playing, _, Some(current) ->
      run_driver(state, driver.leave(current, player))
    // 進行中に最小人数を下回ったらゲームを終了し、ルームを解散する（ADR 0013 / 0017）。
    _, Playing, True, None -> actor.stop()
    // それ以外は在室のまま続ける（開始前・終了後は最小人数を下回っていてよい）。
    _, _, _, _ -> actor.continue(state)
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
    host: state.host,
  )
}

/// ゲーム進行の箱を差し替え、指示を実行する。ゲームが終われば Finished に移る。
fn run_driver(
  state: State,
  step: #(Driver(PlayerId), List(Effect(PlayerId))),
) -> actor.Next(State, Message) {
  let #(next, effects) = step
  list.each(effects, fn(effect) { apply(state, effect) })
  let status = case driver.is_over(next) {
    True -> Finished
    False -> state.status
  }
  actor.continue(State(..state, driver: Some(next), status:))
}

fn apply(state: State, effect: Effect(PlayerId)) -> Nil {
  case effect {
    driver.Broadcast(payload) ->
      dict.each(state.outboxes, fn(_player, outbox) {
        process.send(outbox, game_state(state, payload))
      })
    driver.Deliver(targets, payload) -> deliver_to(state, targets, payload)
    driver.WakeAfter(ms, token) -> {
      let _ = process.send_after(state.self, ms, Wake(token))
      Nil
    }
  }
}

fn game_state(state: State, payload: Dynamic) -> ServerMessage {
  let RoomId(room_id) = state.spec.id
  GameState(game_type: state.spec.game_type, room_id:, payload:)
}
