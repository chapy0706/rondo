import gleam/erlang/process.{type Subject}
import gleam/int
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/connection/connection
import rondo_server/connection/heartbeat
import rondo_server/connection/session
import rondo_server/connection/session_actor
import rondo_server/connection/sessions
import rondo_server/connection/user_number
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/protocol/message.{
  type ServerMessage, CreateRoom, Reconnect, RoomJoined, Session,
}
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

// 表示名（userN）の番号の割り当て（issue-71）。実接続と同じ入口（connection）を通し、
// 番号の窓口（接続アクターの台帳 sessions）が、空いている一番小さい番号から使い回すことを確かめる。

/// テスト用の短い再接続猶予（本番は 10 秒 / ADR 0013）。
const grace_ms = 300

type Client {
  Client(
    socket: Subject(ServerMessage),
    actor: Subject(session_actor.Message),
    resume_token: String,
  )
}

fn server() -> connection.Deps {
  let assert Ok(supervisor) = room_supervisor.start()
  let assert Ok(directory) =
    room_directory.start(supervisor.data, catalog.room_limits())
  let assert Ok(registry) = sessions.start()
  connection.Deps(
    session: session.Deps(directory: directory.data, timing: timing.Normal),
    sessions: registry.data,
    grace_ms:,
    heartbeat: heartbeat.Config(interval_ms: 10_000, timeout_ms: 80),
  )
}

fn connect(deps: connection.Deps) -> Client {
  let socket = process.new_subject()
  let actor = connection.open(deps, socket)
  let assert Ok(Session(resume_token:, ..)) = process.receive(socket, 500)
  Client(socket:, actor:, resume_token:)
}

fn name_of(client: Client) -> String {
  session_actor.get_session(client.actor).name
}

/// ソケットを閉じる（ルームにいなければ、接続はすぐ終わる。いれば猶予に入る）。
fn close(client: Client) -> Nil {
  connection.close(client.actor, client.socket)
}

/// 台帳が使っている番号が expected になるまで待つ（終わった接続の知らせは、非同期に届く）。
fn wait_in_use(deps: connection.Deps, expected: List(Int)) -> Nil {
  do_wait(deps, expected, 100)
}

fn do_wait(deps: connection.Deps, expected: List(Int), tries: Int) -> Nil {
  let now = sessions.numbers_in_use(deps.sessions)
  case now == expected, tries {
    True, _ -> Nil
    False, 0 -> should.equal(now, expected)
    False, _ -> {
      process.sleep(10)
      do_wait(deps, expected, tries - 1)
    }
  }
}

fn create_room(deps: connection.Deps, client: Client) -> String {
  let _ =
    connection.receive(
      deps,
      client.actor,
      client.socket,
      CreateRoom("veryare", None, None),
    )
  let assert Ok(room_id) = joined_room_id(client.socket, 20)
  room_id
}

fn joined_room_id(
  socket: Subject(ServerMessage),
  tries: Int,
) -> Result(String, Nil) {
  case process.receive(socket, 200), tries {
    Ok(RoomJoined(room_id:, ..)), _ -> Ok(room_id)
    Ok(_), 0 -> Error(Nil)
    Ok(_), _ -> joined_room_id(socket, tries - 1)
    Error(Nil), _ -> Error(Nil)
  }
}

// --- 受け入れ条件 -----------------------------------------------------------

pub fn first_connections_are_user1_user2_user3_test() {
  let deps = server()
  let a = connect(deps)
  let b = connect(deps)
  let c = connect(deps)
  [name_of(a), name_of(b), name_of(c)]
  |> should.equal(["user1", "user2", "user3"])
}

pub fn the_next_person_gets_the_freed_number_test() {
  // 3 人が接続して、1 人が抜けると、次に入る人は、空いた番号をもらう。
  let deps = server()
  let _a = connect(deps)
  let b = connect(deps)
  let _c = connect(deps)
  close(b)
  wait_in_use(deps, [1, 3])
  connect(deps) |> name_of |> should.equal("user2")
}

pub fn after_everyone_leaves_the_next_person_is_user1_test() {
  let deps = server()
  let a = connect(deps)
  let b = connect(deps)
  close(a)
  close(b)
  wait_in_use(deps, [])
  connect(deps) |> name_of |> should.equal("user1")
}

pub fn the_number_is_kept_during_the_grace_and_freed_after_it_test() {
  // 猶予の間は番号を取っておき、復帰した人は同じ名前で戻る。猶予が過ぎると空く。
  let deps = server()
  let a = connect(deps)
  let room_id = create_room(deps, a)
  close(a)
  // 猶予の間に入った人は、取っておいた 1 を使わない。
  let b = connect(deps)
  name_of(b) |> should.equal("user2")
  // 復帰する。新しいソケットの接続は、復帰先に付け替わって止まる（その番号は空く）。
  let socket = process.new_subject()
  let fresh = connection.open(deps, socket)
  let resumed =
    connection.receive(deps, fresh, socket, Reconnect(room_id, a.resume_token))
  session_actor.get_session(resumed).name |> should.equal("user1")
  wait_in_use(deps, [1, 2])
  // ルームの参加者の一覧にも、同じ名前で載っている。
  let assert Ok(RoomJoined(players:, ..)) = receive_joined(socket, 20)
  list.map(players, fn(p) { p.name }) |> should.equal(["user1"])
  // もう一度切れて、猶予が過ぎると、1 が空く。
  close(Client(..a, socket:, actor: resumed))
  process.sleep(grace_ms + 100)
  wait_in_use(deps, [2])
  connect(deps) |> name_of |> should.equal("user1")
}

fn receive_joined(
  socket: Subject(ServerMessage),
  tries: Int,
) -> Result(ServerMessage, Nil) {
  case process.receive(socket, 200), tries {
    Ok(RoomJoined(..) as joined), _ -> Ok(joined)
    Ok(_), 0 -> Error(Nil)
    Ok(_), _ -> receive_joined(socket, tries - 1)
    Error(Nil), _ -> Error(Nil)
  }
}

pub fn the_number_is_freed_when_the_connection_crashes_test() {
  // 接続のプロセスが異常終了しても、番号が空く。
  let deps = server()
  let a = connect(deps)
  let _b = connect(deps)
  let assert Ok(pid) = process.subject_owner(a.actor)
  process.kill(pid)
  wait_in_use(deps, [2])
  connect(deps) |> name_of |> should.equal("user1")
}

pub fn set_name_does_not_leak_the_number_test() {
  // 名前を変えた人が抜けても、元の番号は空く（番号は接続に付いている）。
  let deps = server()
  let a = connect(deps)
  let _ = connection.receive(deps, a.actor, a.socket, message.SetName("", "あめ"))
  name_of(a) |> should.equal("あめ")
  close(a)
  wait_in_use(deps, [])
}

pub fn many_simultaneous_connections_never_share_a_name_test() {
  // 200 接続を同時につなぎ、名前が重ならず、1〜200 になる。一部を切り、つなぎ直すと、
  // 空いた番号の小さい順に使われる。
  let deps = server()
  let opened = process.new_subject()
  list.each(span(1, 200), fn(_) {
    let socket = process.new_subject()
    process.spawn(fn() {
      let actor = connection.open(deps, socket)
      process.send(opened, Client(socket:, actor:, resume_token: ""))
    })
  })
  let clients = collect(opened, 200, [])
  let given = list.map(clients, fn(client) { number_of(name_of(client)) })
  list.sort(given, int.compare) |> should.equal(span(1, 200))
  wait_in_use(deps, span(1, 200))

  // 1、7、100 と、151〜200 が抜ける。
  let leaving_numbers = [1, 7, 100, ..span(151, 200)]
  let #(leaving, _) =
    list.partition(clients, fn(client) {
      list.contains(leaving_numbers, number_of(name_of(client)))
    })
  list.each(leaving, close)
  wait_in_use(
    deps,
    list.filter(span(1, 200), fn(n) { !list.contains(leaving_numbers, n) }),
  )

  list.map(leaving_numbers, fn(_) { connect(deps) |> name_of })
  |> should.equal(list.map(leaving_numbers, user_number.name))
}

fn collect(
  opened: Subject(Client),
  count: Int,
  acc: List(Client),
) -> List(Client) {
  case count {
    0 -> acc
    _ -> {
      let assert Ok(client) = process.receive(opened, 2000)
      collect(opened, count - 1, [client, ..acc])
    }
  }
}

fn number_of(name: String) -> Int {
  let assert "user" <> digits = name
  let assert Ok(number) = int.parse(digits)
  number
}

/// from から to まで（両端を含む）の整数。
fn span(from: Int, to: Int) -> List(Int) {
  do_span(to, from, [])
}

fn do_span(current: Int, from: Int, acc: List(Int)) -> List(Int) {
  case current < from {
    True -> acc
    False -> do_span(current - 1, from, [current, ..acc])
  }
}
