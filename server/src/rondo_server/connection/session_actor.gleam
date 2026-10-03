/// 接続アクター（ADR 0006 / 0013 / issue-31）。プレイヤー1人につき1つ。
///
/// 接続ごとの処理（connection/session）を状態として持ち、ルームからの配信の受け口になる。
/// ソケット（WebSocket のプロセス）とは別のプロセスなので、ソケットが切れても再接続猶予の
/// 間はプレイヤーとして残る。
///
/// - ソケットが付いていれば、ルームの配信と返信をソケットへ流す
/// - ルームにいる間に切断したら、配信を上限付きでため、猶予のタイマーを張る
/// - 猶予内に、同じ resume_token と同じルーム ID で復帰すれば、新しいソケットに付け替え、
///   session と room-joined を送ってから、ためた配信を流す
/// - 猶予を過ぎたらルームへ離脱（Leave）を伝えて止まる。ルームにいなければ切断で止まる
/// - 復帰できるのは切断中だけ。つながっている間は、正しいトークンでも付け替えない
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/otp/actor
import rondo_server/connection/session.{type Deps, type Session}
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, PlayerInfo, RoomJoined,
  Session as SessionMessage,
}
import rondo_server/room/room_actor.{PlayerId}

/// 切断中にためておく配信の上限。超えたら古いものから捨てる。
const buffer_limit = 200

pub type Message {
  /// クライアントからの電文（再接続以外）。
  FromClient(ClientMessage)
  /// ルームからの配信。
  FromRoom(ServerMessage)
  /// ソケットが閉じた。今のソケットのときだけ切断として扱う。
  Detach(socket: Subject(ServerMessage))
  /// 再接続。切断中で、トークンとルーム ID が一致すれば socket に付け替えて True を返す。
  Resume(
    room_id: String,
    resume_token: String,
    socket: Subject(ServerMessage),
    reply: Subject(Bool),
  )
  /// 猶予のタイマー。generation が今と違えば（復帰済み）何もしない。
  Expire(generation: Int)
  /// この接続を終える（復帰で使われなくなった新しい接続など）。ルームにいれば抜ける。
  Stop
  /// 今の状態（台帳への登録・テスト用）。
  GetSession(reply: Subject(Session))
}

type State {
  State(
    self: Subject(Message),
    deps: Deps,
    grace_ms: Int,
    session: Session,
    socket: Option(Subject(ServerMessage)),
    /// 切断中にためた配信（新しいものが先頭）。
    buffer: List(ServerMessage),
    /// 切断・復帰のたびに進める。古い猶予タイマーを見分ける。
    generation: Int,
  )
}

/// 接続アクターを起動する。本人のソケットへ session（識別子と復帰トークン）を送る。
pub fn start(
  deps: Deps,
  socket: Subject(ServerMessage),
  grace_ms: Int,
) -> actor.StartResult(Subject(Message)) {
  actor.new_with_initialiser(1000, fn(self) {
    // ルームの配信はこの送信先に届く。持ち主はこのアクター。
    let room_outbox = process.new_subject()
    let selector =
      process.new_selector()
      |> process.select(self)
      |> process.select_map(room_outbox, FromRoom)
    let #(session, replies) = session.start(deps, room_outbox)
    list.each(replies, process.send(socket, _))
    State(
      self:,
      deps:,
      grace_ms:,
      session:,
      socket: Some(socket),
      buffer: [],
      generation: 0,
    )
    |> actor.initialised
    |> actor.selecting(selector)
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
}

pub fn client_message(actor: Subject(Message), incoming: ClientMessage) -> Nil {
  process.send(actor, FromClient(incoming))
}

pub fn detach(actor: Subject(Message), socket: Subject(ServerMessage)) -> Nil {
  process.send(actor, Detach(socket))
}

pub fn resume(
  actor: Subject(Message),
  room_id: String,
  resume_token: String,
  socket: Subject(ServerMessage),
) -> Bool {
  process.call(actor, 1000, Resume(room_id, resume_token, socket, _))
}

pub fn stop(actor: Subject(Message)) -> Nil {
  process.send(actor, Stop)
}

pub fn get_session(actor: Subject(Message)) -> Session {
  process.call(actor, 1000, GetSession)
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    FromClient(incoming) -> {
      let #(session, replies) =
        session.handle(state.session, state.deps, incoming)
      let state = State(..state, session:)
      list.each(replies, deliver(state, _))
      actor.continue(state)
    }

    FromRoom(outgoing) ->
      case state.socket {
        Some(socket) -> {
          process.send(socket, outgoing)
          actor.continue(state)
        }
        None ->
          actor.continue(State(..state, buffer: keep(state.buffer, outgoing)))
      }

    Detach(socket) ->
      case state.socket == Some(socket), state.session.room {
        // 今のソケットでなければ（付け替え済みの古いソケット）無視する。
        False, _ -> actor.continue(state)
        // ルームにいなければ、保つものが無いので終わる。
        True, None -> actor.stop()
        // ルームにいれば、猶予のタイマーを張って待つ。
        True, Some(_) -> {
          let generation = state.generation + 1
          let _ =
            process.send_after(state.self, state.grace_ms, Expire(generation))
          actor.continue(State(..state, socket: None, generation:))
        }
      }

    Resume(room_id, resume_token, socket, reply) ->
      case can_resume(state, room_id, resume_token) {
        False -> {
          process.send(reply, False)
          actor.continue(state)
        }
        True -> {
          process.send(reply, True)
          resume_on(state, socket)
        }
      }

    Expire(generation) ->
      case generation == state.generation && state.socket == None {
        True -> {
          // 猶予切れ。ルームへ離脱を伝えて終わる（ADR 0013）。
          session.close(state.session)
          actor.stop()
        }
        False -> actor.continue(state)
      }

    Stop -> {
      session.close(state.session)
      actor.stop()
    }

    GetSession(reply) -> {
      process.send(reply, state.session)
      actor.continue(state)
    }
  }
}

/// 復帰できるか。切断中で、トークンとルーム ID が一致すること。
fn can_resume(state: State, room_id: String, resume_token: String) -> Bool {
  case state.socket, state.session.room {
    None, Some(joined) ->
      joined.room_id == room_id && state.session.resume_token == resume_token
    _, _ -> False
  }
}

/// 新しいソケットに付け替える。session と room-joined を送ってから、ためた配信を流す。
fn resume_on(
  state: State,
  socket: Subject(ServerMessage),
) -> actor.Next(State, Message) {
  let session = state.session
  process.send(socket, SessionMessage(session.player_id, session.resume_token))
  case session.room {
    Some(joined) -> {
      let players =
        room_actor.snapshot(joined.room).players
        |> list.map(fn(player) {
          let PlayerId(id) = player.id
          PlayerInfo(player_id: id, name: player.name)
        })
      process.send(
        socket,
        RoomJoined(
          game_type: joined.game_type,
          room_id: joined.room_id,
          you: session.player_id,
          players:,
        ),
      )
    }
    None -> Nil
  }
  list.each(list.reverse(state.buffer), process.send(socket, _))
  actor.continue(
    State(
      ..state,
      socket: Some(socket),
      buffer: [],
      generation: state.generation + 1,
    ),
  )
}

/// 本人への返信。電文はソケットから来るので、切断中に返信が生じることは無い（来ても捨てる）。
fn deliver(state: State, outgoing: ServerMessage) -> Nil {
  case state.socket {
    Some(socket) -> process.send(socket, outgoing)
    None -> Nil
  }
}

fn keep(
  buffer: List(ServerMessage),
  outgoing: ServerMessage,
) -> List(ServerMessage) {
  list.take([outgoing, ..buffer], buffer_limit)
}
