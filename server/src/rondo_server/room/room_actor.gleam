import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/otp/actor
import rondo_server/protocol/message.{
  type ServerMessage, GameEnded, GameStarted, GameState, GameStateTo, PlayerInfo,
  PlayerJoined, PlayerLeft,
}
import rondo_server/room/authority.{type Authority, type Outcome}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/expiry

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
    /// ルーム名（issue-58）。作成の入口（connection/session）が room/room_name で整えた
    /// 名前を入れる。ゲームの組み立て関数（catalog / veryare.spec 等）は空のまま返す。
    name: String,
    min_players: Int,
    max_players: Int,
    authority: Option(AuthorityFactory),
    /// ゲーム進行の差し込み口。Some のゲームでは、進行中の離脱の扱いもゲームに委ねる。
    driver: Option(DriverFactory),
    /// 入室後に初めて分かる案内（探索時間など / ADR 0024）。参加者が送信先を登録した
    /// ときにだけ送り、ルーム一覧には出さない。
    member_info: Option(Dynamic),
    /// 接続を持たない参加者（CPU / ADR 0038）。作成時から参加者で、定員と人数の判定に
    /// 数える。送信先を持たないので、限定配信・全体配信は届かない。
    bots: List(Player),
    /// 結果が確定してから、ルームを閉じるまでの時間（ミリ秒 / issue-70・ADR 0050）。本番は
    /// 3 分（expiry.default_close_ms）。テスト用の短縮は games/timing の finished_close_ms。
    close_after_ms: Int,
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
    /// ゲーム種別。
    game_type: String,
    /// ルーム名（issue-58）。
    name: String,
    /// 今参加できるか。開始前か、ゲームが参加を受け付けている間（veryare の鬼選出中）。
    /// ルーム一覧の waiting / playing に使う。定員は別に見る。
    joinable: Bool,
  )
}

/// ルームアクターが受け取るメッセージ。
pub type Message {
  /// 参加する。定員・重複・開始済みを判定して可否を返す。差し込み口を持つゲームは、
  /// ゲームが受け付ける間（veryare の鬼選出中）は進行中でも参加できる。
  Join(player: Player, reply: Subject(Result(Nil, JoinError)))
  /// 参加と同時に送信先を登録する（実接続 / issue-31）。参加で起きる配信（ゲームの通知）を
  /// 本人も受け取れるよう、ゲームに参加を伝える前に送信先を登録する。
  JoinAndSubscribe(
    player: Player,
    outbox: Subject(ServerMessage),
    reply: Subject(Result(Nil, JoinError)),
  )
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
  /// 再接続で戻った参加者に、入室後の案内と、ゲームの今の状態（driver の on_subscribe）を
  /// 送り直す（issue-29a）。参加者でない・送信先が無ければ何もしない。
  Resync(player: PlayerId)
  /// ルームを明示的に解散する。
  Dissolve
  /// ゲームが終わった（Finished に移った）ときに、ルーム ID を知らせる先を登録する（issue-51）。
  /// ルーム台帳が、終わったルームを同時ルーム数に数えないために使う。すでに終わっていれば、すぐ知らせる。
  NotifyWhenFinished(watcher: Subject(String))
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
    /// これまでに参加した人の表示名（CPU を含む）。離脱しても消さない。ゲーム終了の
    /// 結果に、途中で離脱した人の名前も載せるため（issue-42）。
    names: Dict(PlayerId, String),
    /// ゲームが終わったときに、ルーム ID を知らせる先（issue-51 / ルーム台帳）。
    finish_watchers: List(Subject(String)),
    /// 結果が確定した時刻（単調な時計のミリ秒 / issue-70）。閉じるまでの残りを計るのに使う。
    finished_at: Option(Int),
    /// 送った結果（game-ended の result）。結果のあとに送信先を登録し直した人へ、残りつきで
    /// 送り直す（issue-70）。ゲーム進行の差し込み口（driver）が結果を出したときだけ Some。
    ended: Option(message.RealtimeResult),
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
      players: spec.bots
        |> list.map(fn(bot) { #(bot.id, bot) })
        |> dict.from_list,
      outboxes: dict.new(),
      authority: None,
      result: None,
      driver: None,
      host: None,
      names: spec.bots
        |> list.map(fn(bot) { #(bot.id, bot.name) })
        |> dict.from_list,
      finish_watchers: [],
      finished_at: None,
      ended: None,
    )
    |> actor.initialised
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
}

/// 参加する。
/// 参加して、同時に送信先を登録する。
pub fn join_and_subscribe(
  room: Subject(Message),
  player: Player,
  outbox: Subject(ServerMessage),
) -> Result(Nil, JoinError) {
  process.call(room, 1000, JoinAndSubscribe(player, outbox, _))
}

/// ゲームが終わったときに、ルーム ID を watcher へ知らせてもらう（issue-51）。
pub fn notify_when_finished(
  room: Subject(Message),
  watcher: Subject(String),
) -> Nil {
  process.send(room, NotifyWhenFinished(watcher))
}

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

/// 今の状態を、止まらずに読む（ADR 0047）。ルームが落ちている・timeout ミリ秒のうちに答えないときは
/// Error。問い合わせた側（接続の処理）を止めない（snapshot は、相手が落ちていると panic する）。
/// 答えが timeout より遅れて届いたときは、問い合わせた側の受け箱に 1 通残る（捨てる先が無いため。
/// 1 秒以上答えないルームでだけ起こる）。
pub fn try_snapshot(
  room: Subject(Message),
  timeout: Int,
) -> Result(RoomState, Nil) {
  case process.subject_owner(room) {
    Error(Nil) -> Error(Nil)
    Ok(pid) -> {
      let monitor = process.monitor(pid)
      let reply = process.new_subject()
      process.send(room, Snapshot(reply))
      let answer =
        process.new_selector()
        |> process.select_map(reply, Ok)
        |> process.select_specific_monitor(monitor, fn(_down) { Error(Nil) })
        |> process.selector_receive(timeout)
      process.demonitor_process(monitor)
      case answer {
        Ok(Ok(state)) -> Ok(state)
        _ -> Error(Nil)
      }
    }
  }
}

/// ルームを解散する。
/// 再接続で戻った参加者へ、今の状態を送り直してもらう（issue-29a）。
pub fn resync(room: Subject(Message), player: PlayerId) -> Nil {
  process.send(room, Resync(player))
}

pub fn dissolve(room: Subject(Message)) -> Nil {
  process.send(room, Dissolve)
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Join(player, reply) -> handle_join(state, player, None, reply)

    JoinAndSubscribe(player, outbox, reply) ->
      handle_join(state, player, Some(outbox), reply)

    Leave(player) -> handle_leave(state, player)

    StartGame(reply) -> handle_start_game(state, reply)

    GameEvent(player, payload) -> handle_game_event(state, player, payload)

    Subscribe(player, outbox) -> handle_subscribe(state, player, outbox)

    SendTo(targets, payload) -> {
      deliver_to(state, targets, payload)
      actor.continue(state)
    }

    Wake(token) ->
      case expiry.is_expire_token(token), state.status, state.driver {
        // 結果が確定してから、閉じるまでの時間がたった（issue-70）。進行中のルームは閉じない。
        True, Finished, _ -> expire(state)
        True, _, _ -> actor.continue(state)
        False, Playing, Some(current) ->
          run_driver(state, driver.wake(current, token))
        False, _, _ -> actor.continue(state)
      }

    Snapshot(reply) -> {
      process.send(reply, to_state(state))
      actor.continue(state)
    }

    Resync(player) -> {
      case dict.get(state.outboxes, player) {
        Ok(outbox) -> welcome(state, player, outbox)
        Error(Nil) -> Nil
      }
      actor.continue(state)
    }

    Dissolve -> actor.stop()
    NotifyWhenFinished(watcher) -> {
      case state.status {
        Finished -> process.send(watcher, room_id_of(state))
        _ -> Nil
      }
      actor.continue(
        State(..state, finish_watchers: [watcher, ..state.finish_watchers]),
      )
    }
  }
}

fn handle_join(
  state: State,
  player: Player,
  outbox: Option(Subject(ServerMessage)),
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
      notify_joined(state, player)
      let assert Some(current) = state.driver
      // 送信先を先に登録し（参加で起きる全員への通知が、本人にも届くように / issue-59）、入室を処理した
      // 後の状態で、入室後の案内と、いま届けるべき状態を送る（入室の前の状態で送ると、参加で変わった
      // ところが本人に届かないことがある）。
      let state =
        State(
          ..state,
          players: dict.insert(state.players, player.id, player),
          names: dict.insert(state.names, player.id, player.name),
        )
        |> add_outbox(player.id, outbox)
      let state = drive(state, driver.join(current, player.id))
      case outbox {
        Some(outbox) -> welcome(state, player.id, outbox)
        None -> Nil
      }
      actor.continue(state)
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
      notify_joined(state, player)
      let host = case state.host {
        None -> Some(player.id)
        some -> some
      }
      actor.continue(
        State(
          ..state,
          players: dict.insert(state.players, player.id, player),
          names: dict.insert(state.names, player.id, player.name),
          host:,
        )
        |> register(player.id, outbox),
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
      broadcast(state, GameStarted(state.spec.game_type, room_id_of(state)))
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
              ..enter_finished(state),
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

/// 参加者の送信先を登録するだけ（案内は送らない）。
fn add_outbox(
  state: State,
  player: PlayerId,
  outbox: Option(Subject(ServerMessage)),
) -> State {
  case outbox {
    Some(outbox) ->
      State(..state, outboxes: dict.insert(state.outboxes, player, outbox))
    None -> state
  }
}

/// 参加者の送信先を登録し、入室後の案内を送る（JoinAndSubscribe 用）。
fn register(
  state: State,
  player: PlayerId,
  outbox: Option(Subject(ServerMessage)),
) -> State {
  case outbox {
    Some(outbox) -> {
      let state =
        State(..state, outboxes: dict.insert(state.outboxes, player, outbox))
      welcome(state, player, outbox)
      state
    }
    None -> state
  }
}

/// 送信先を登録した人へ、入室後の案内と、ゲームの今の状態（driver の on_subscribe）を送る。
/// state の outboxes には、すでに本人の送信先が入っていること（限定配信で届けるため）。
fn welcome(
  state: State,
  player: PlayerId,
  outbox: Subject(ServerMessage),
) -> Nil {
  case state.spec.member_info {
    Some(info) -> process.send(outbox, game_state(state, info))
    None -> Nil
  }
  case state.driver {
    Some(current) ->
      list.each(driver.subscribed(current, player), fn(effect) {
        apply(state, effect)
      })
    None -> Nil
  }
  // 結果のあとに登録し直した人（復帰）へ、結果を、閉じるまでの残りつきで送り直す（issue-70）。
  case state.status, state.ended {
    Finished, Some(result) ->
      process.send(
        outbox,
        GameEnded(
          game_type: state.spec.game_type,
          room_id: room_id_of(state),
          result:,
          closes_in_ms: closes_in_ms(state),
        ),
      )
    _, _ -> Nil
  }
}

fn handle_subscribe(
  state: State,
  player: PlayerId,
  outbox: Subject(ServerMessage),
) -> actor.Next(State, Message) {
  case dict.has_key(state.players, player) {
    True -> {
      let state =
        State(..state, outboxes: dict.insert(state.outboxes, player, outbox))
      welcome(state, player, outbox)
      actor.continue(state)
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
  let was_member = dict.has_key(state.players, player)
  let players = dict.delete(state.players, player)
  let outboxes = dict.delete(state.outboxes, player)
  let remaining = dict.size(players)
  let below_min = remaining < state.spec.min_players
  // CPU（接続を持たない参加者）だけが残っても、遊ぶ人はいないので解散する。
  let humans =
    dict.keys(players)
    |> list.count(fn(id) {
      !list.any(state.spec.bots, fn(bot) { bot.id == id })
    })

  let state = State(..state, players:, outboxes:)
  case was_member {
    True -> {
      let PlayerId(id) = player
      broadcast(state, PlayerLeft(room_id_of(state), id))
    }
    False -> Nil
  }

  case humans, state.status, below_min, state.driver {
    // 人間が誰も残らなければ解散する。
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
    game_type: state.spec.game_type,
    name: state.spec.name,
    joinable: case state.status, state.driver {
      Open, _ -> True
      Playing, Some(current) -> driver.accepts_join(current)
      _, _ -> False
    },
  )
}

fn room_id_of(state: State) -> String {
  let RoomId(id) = state.spec.id
  id
}

/// 購読中の全員に送る（参加・離脱・開始の知らせ）。
fn broadcast(state: State, message: ServerMessage) -> Nil {
  dict.each(state.outboxes, fn(_player, outbox) {
    process.send(outbox, message)
  })
}

/// 参加を、すでにいる人に知らせる（参加した本人はまだ購読していない）。
fn notify_joined(state: State, player: Player) -> Nil {
  let PlayerId(id) = player.id
  broadcast(
    state,
    PlayerJoined(
      room_id_of(state),
      PlayerInfo(player_id: id, name: player.name),
    ),
  )
}

/// ゲーム進行の箱を差し替え、指示を実行する。ゲームが終われば Finished に移る。
fn run_driver(
  state: State,
  step: #(Driver(PlayerId), List(Effect(PlayerId))),
) -> actor.Next(State, Message) {
  actor.continue(drive(state, step))
}

/// ゲーム進行の箱を差し替え、指示を実行した後の状態。
fn drive(
  state: State,
  step: #(Driver(PlayerId), List(Effect(PlayerId))),
) -> State {
  let #(next, effects) = step
  list.each(effects, fn(effect) { apply(state, effect) })
  // 送った結果を控える（結果のあとに送信先を登録し直した人へ、送り直すため / issue-70）。
  let ended =
    list.fold(effects, state.ended, fn(ended, effect) {
      case effect {
        driver.Finish(order, standings) ->
          Some(realtime_result(state, order, standings))
        _ -> ended
      }
    })
  let state = State(..state, driver: Some(next), ended:)
  case state.status != Finished && driver.is_over(next) {
    True -> enter_finished(state)
    False -> state
  }
}

/// 結果が確定した（Finished に移る）。台帳へ知らせ、確定した時刻を控え、閉じるタイマーを張る
/// （issue-70。閉じるまでの時間は spec.close_after_ms）。
fn enter_finished(state: State) -> State {
  announce_finished(state)
  let _ =
    process.send_after(
      state.self,
      state.spec.close_after_ms,
      Wake(expiry.expire_token),
    )
  State(..state, status: Finished, finished_at: Some(monotonic_ms()))
}

/// 閉じる（issue-70）。残っている参加者へ room-expired を送ってから、ふつうに終わる。接続は、
/// ルームの監視でルームを外し（終わり方が normal なので room-closed は送らない / ADR 0047）、
/// 台帳は、監視でルームを外す。
fn expire(state: State) -> actor.Next(State, Message) {
  dict.each(state.outboxes, fn(_player, outbox) {
    process.send(outbox, expiry.expired_notice())
  })
  actor.stop()
}

/// 閉じるまでの残り（ミリ秒）。結果が確定していなければ None。
fn closes_in_ms(state: State) -> Option(Int) {
  case state.finished_at {
    Some(finished_at) ->
      Some(expiry.remaining_ms(
        finished_at:,
        now: monotonic_ms(),
        close_ms: state.spec.close_after_ms,
      ))
    None -> None
  }
}

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int

/// ゲームが終わった（Finished に移る）ことを、登録された先へ知らせる（issue-51）。
fn announce_finished(state: State) -> Nil {
  list.each(state.finish_watchers, fn(watcher) {
    process.send(watcher, room_id_of(state))
  })
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
    // 送信先を登録している参加者全員へ送る。参加者でない接続には送らない。
    driver.Finish(order, standings) ->
      broadcast(
        state,
        GameEnded(
          game_type: state.spec.game_type,
          room_id: room_id_of(state),
          result: realtime_result(state, order, standings),
          // 結果を出した時点では、閉じるまでの時間が、まるごと残っている（issue-70）。
          closes_in_ms: Some(state.spec.close_after_ms),
        ),
      )
  }
}

/// ゲームが返した結果の行に、ルームが控えた表示名を付ける。
fn realtime_result(
  state: State,
  order: message.ScoreOrder,
  standings: List(driver.Standing(PlayerId)),
) -> message.RealtimeResult {
  message.RealtimeResult(
    order:,
    rankings: list.map(standings, fn(standing) {
      let PlayerId(id) = standing.player
      let name = case dict.get(state.names, standing.player) {
        Ok(name) -> name
        Error(Nil) -> id
      }
      let details = case standing.details {
        [] -> None
        some ->
          Some(
            list.map(some, fn(pair) { #(pair.0, message.DetailText(pair.1)) }),
          )
      }
      message.RankingEntry(
        player_id: id,
        name:,
        rank: standing.rank,
        result: message.PlayResult(
          score: message.IntNumber(standing.score),
          details:,
        ),
      )
    }),
  )
}

fn game_state(state: State, payload: Dynamic) -> ServerMessage {
  let RoomId(room_id) = state.spec.id
  GameState(game_type: state.spec.game_type, room_id:, payload:)
}
