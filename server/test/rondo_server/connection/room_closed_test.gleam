//// ルームのプロセスが落ちたとき（issue-60 の後半 / ADR 0047）。接続の入口（connection）を通した結合テスト。
////
//// - 落ちた（異常に終わった）ルームに入っていた全員に、error の room-closed が届き、入っているルームが外れる
////   （新しいルームを作れる）
//// - 落ちたルームは作り直さない（Temporary）。台帳から外れ、同時ルーム数に数えない。supervisor の子の数と、
////   台帳の数が揃う（再起動で数え漏れしていた根が消える）
//// - ふつうに終わったルーム（退出で解散・解散の指示）では、room-closed は届かない
//// - 応答しないルームがあっても、ほかのルームの一覧と参加が止まらない

import gleam/erlang/process.{type Pid, type Subject}
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/connection/connection
import rondo_server/connection/heartbeat
import rondo_server/connection/session
import rondo_server/connection/session_actor
import rondo_server/connection/sessions
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, CreateRoom, ErrorMessage, JoinRoom,
  LeaveRoom, ListRooms, Reconnect, RoomJoined, RoomList, Session,
}
import rondo_server/room/room_actor
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

const grace_ms = 400

type Client {
  Client(
    socket: Subject(ServerMessage),
    actor: Subject(session_actor.Message),
    player_id: String,
    resume_token: String,
  )
}

type Server {
  Server(deps: connection.Deps, supervisor: Pid)
}

fn server() -> Server {
  let assert Ok(supervisor) = room_supervisor.start()
  let assert Ok(directory) =
    room_directory.start(supervisor.data, catalog.room_limits())
  let assert Ok(registry) = sessions.start()
  Server(
    deps: connection.Deps(
      session: session.Deps(directory: directory.data, timing: timing.Normal),
      sessions: registry.data,
      grace_ms:,
      heartbeat: heartbeat.Config(interval_ms: 10_000, timeout_ms: 80),
    ),
    supervisor: supervisor.pid,
  )
}

fn connect(s: Server) -> Client {
  let socket = process.new_subject()
  let actor = connection.open(s.deps, socket)
  let assert Ok(Session(player_id:, resume_token:)) =
    process.receive(socket, 500)
  Client(socket:, actor:, player_id:, resume_token:)
}

fn send(s: Server, client: Client, incoming: ClientMessage) -> Client {
  let actor = connection.receive(s.deps, client.actor, client.socket, incoming)
  Client(..client, actor:)
}

fn drain(client: Client) -> List(ServerMessage) {
  do_drain(client.socket, [])
}

fn do_drain(socket, acc) {
  case process.receive(socket, 60) {
    Ok(m) -> do_drain(socket, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn joined_room(messages: List(ServerMessage)) -> Result(String, Nil) {
  list.find_map(messages, fn(m) {
    case m {
      RoomJoined(room_id:, ..) -> Ok(room_id)
      _ -> Error(Nil)
    }
  })
}

/// 届いた error の code。
fn error_codes(messages: List(ServerMessage)) -> List(String) {
  list.filter_map(messages, fn(m) {
    case m {
      ErrorMessage(code:, ..) -> Ok(code)
      _ -> Error(Nil)
    }
  })
}

/// client がルームを作る。ルーム ID。
fn create(s: Server, client: Client) -> String {
  let _ = send(s, client, CreateRoom("veryare", None, None))
  let assert Ok(room_id) = joined_room(drain(client))
  room_id
}

fn room_pid(s: Server, room_id: String) -> Pid {
  let assert Ok(room) = room_directory.find(s.deps.session.directory, room_id)
  let assert Ok(pid) = process.subject_owner(room)
  pid
}

@external(erlang, "erlang", "suspend_process")
fn suspend_process(pid: Pid) -> Bool

@external(erlang, "erlang", "resume_process")
fn resume_process(pid: Pid) -> Bool

// --- 落ちたとき ---------------------------------------------------------------

/// ルームのプロセスを強制終了すると、入っていた全員に room-closed が届く。
pub fn killed_room_sends_room_closed_to_everyone_test() {
  let s = server()
  let a = connect(s)
  let room_id = create(s, a)
  let b = connect(s)
  let _ = send(s, b, JoinRoom("veryare", room_id))
  process.sleep(200)
  let _ = drain(a)
  let _ = drain(b)

  process.kill(room_pid(s, room_id))
  process.sleep(50)
  error_codes(drain(a)) |> should.equal(["room-closed"])
  error_codes(drain(b)) |> should.equal(["room-closed"])
}

/// 落ちたあと、入っていた人は、入っているルームが外れ、新しいルームを作れる（already-in-room にならない）。
pub fn member_of_killed_room_can_create_again_test() {
  let s = server()
  let a = connect(s)
  let room_id = create(s, a)
  process.kill(room_pid(s, room_id))
  process.sleep(50)
  let _ = drain(a)
  let _ = send(s, a, CreateRoom("veryare", None, None))
  let again = drain(a)
  error_codes(again) |> should.equal([])
  let assert Ok(next) = joined_room(again)
  { next != room_id } |> should.be_true
}

/// 落ちたルームは作り直さない（Temporary）。台帳から外れ、同時ルーム数に数えず、supervisor の子の数と
/// 台帳の数が揃う。上限（3）まで作ったあとで 1 つ落ちれば、新しく作れる。
pub fn killed_room_is_not_restarted_and_frees_the_limit_test() {
  let s = server()
  let directory = s.deps.session.directory
  let clients = [connect(s), connect(s), connect(s)]
  let rooms = list.map(clients, fn(c) { create(s, c) })
  room_directory.active_count(directory, "veryare") |> should.equal(3)
  let assert [first, ..] = rooms

  process.kill(room_pid(s, first))
  process.sleep(50)
  room_directory.active_count(directory, "veryare") |> should.equal(2)
  room_directory.find(directory, first) |> should.equal(Error(Nil))
  // 作り直していれば、supervisor の子は 3 のまま（台帳は 2）で、数え漏れになる。
  room_supervisor.room_count(s.supervisor) |> should.equal(2)

  let late = connect(s)
  let _ = send(s, late, CreateRoom("veryare", None, None))
  let made = drain(late)
  error_codes(made) |> should.equal([])
  joined_room(made) |> should.be_ok
  room_supervisor.room_count(s.supervisor) |> should.equal(3)
}

/// 切断している間にルームが落ちたら、戻る先が無いので、接続は終わる。戻ってきた接続は、前のルームに
/// 戻れず、reconnect-failed で断られる（固まったルームに戻さない）。
pub fn room_killed_while_disconnected_refuses_resume_test() {
  let s = server()
  let a = connect(s)
  let room_id = create(s, a)
  connection.close(a.actor, a.socket)
  process.sleep(20)
  process.kill(room_pid(s, room_id))
  process.sleep(50)
  let back = connect(s)
  let _ = send(s, back, Reconnect(room_id, a.resume_token))
  error_codes(drain(back)) |> should.equal(["reconnect-failed"])
}

// --- ふつうに終わったとき -------------------------------------------------------------

/// 退出で解散したルームでは、room-closed は届かない。
pub fn room_dissolved_by_leaving_sends_no_room_closed_test() {
  let s = server()
  let a = connect(s)
  let room_id = create(s, a)
  let _ = send(s, a, LeaveRoom(room_id))
  process.sleep(50)
  error_codes(drain(a)) |> should.equal([])
}

/// 解散の指示（ふつうの終了）で閉じたルームでは、入っていた人にも room-closed は届かない。
pub fn normally_stopped_room_sends_no_room_closed_test() {
  let s = server()
  let a = connect(s)
  let room_id = create(s, a)
  let b = connect(s)
  let _ = send(s, b, JoinRoom("veryare", room_id))
  process.sleep(200)
  let _ = drain(a)
  let _ = drain(b)
  let assert Ok(room) = room_directory.find(s.deps.session.directory, room_id)
  room_actor.dissolve(room)
  process.sleep(50)
  error_codes(drain(a)) |> should.equal([])
  error_codes(drain(b)) |> should.equal([])
}

// --- 応答しないルーム -----------------------------------------------------------------

/// 応答しないルームがあっても、一覧は（そのルームを飛ばして）返り、ほかのルームへの参加も止まらない。
pub fn unresponsive_room_does_not_block_list_and_join_test() {
  let s = server()
  let a = connect(s)
  let stuck = create(s, a)
  let b = connect(s)
  let open = create(s, b)
  let pid = room_pid(s, stuck)
  suspend_process(pid)

  let c = connect(s)
  let _ = send(s, c, ListRooms("veryare"))
  let listed =
    list.find_map(do_drain_until(c.socket, 2500), fn(m) {
      case m {
        RoomList(rooms:, ..) -> Ok(list.map(rooms, fn(r) { r.room_id }))
        _ -> Error(Nil)
      }
    })
  listed |> should.equal(Ok([open]))

  let _ = send(s, c, JoinRoom("veryare", open))
  joined_room(do_drain_until(c.socket, 2500)) |> should.equal(Ok(open))

  // 応答しないルームへの参加は、止まらずに断られる（見つからない扱い）。
  let d = connect(s)
  let _ = send(s, d, JoinRoom("veryare", stuck))
  error_codes(do_drain_until(d.socket, 2500))
  |> should.equal(["room-not-found"])
  resume_process(pid)
  Nil
}

/// 最初の電文を timeout ミリ秒まで待ち、そのあとは届き終わるまで集める。
fn do_drain_until(socket, timeout: Int) -> List(ServerMessage) {
  case process.receive(socket, timeout) {
    Ok(m) -> [m, ..do_drain(socket, [])]
    Error(Nil) -> []
  }
}
