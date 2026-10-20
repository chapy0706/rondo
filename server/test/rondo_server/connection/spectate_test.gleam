//// 観戦ルーム（issue-67 段階 2 の ②）。接続の入口（connection）を通した結合テスト。観戦者は、ボットと同じ
//// 電文（create-room・join-room・leave-room）でつなぐ接続。
////
//// フェーズ時間と、観戦ルームの時間（結果を見せる 10 秒・0 人で閉じる 60 秒）を 1/1000 に縮める。観戦
//// ルームは、旗が下りているので、このテストの間だけ、開発用の環境変数 RONDO_SPECTATE_DEV=1 を付ける。
////
//// - 旗も環境変数も無ければ、spectate: 1 の作成は invalid-settings で断る
//// - 作った人は、観戦者として入る（参加者は CPU だけ）。試合は人間なしで結果まで進み、同じルームで次の
////   試合が始まる。連続 5 試合を回しても、プロセスの数とルームのメモリが増え続けない
//// - 一覧に、観戦ルームの印（spectate）と、観戦者の数・上限が出る
//// - 観戦者が退出して 0 人のまま一定時間たつと、閉じ、枠が戻る
//// - 切断の猶予（ADR 0013）の間は、0 人と数えない（猶予を過ぎてから、閉じる時刻を数える）

import gleam/dynamic
import gleam/erlang/process.{type Pid, type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/connection/connection
import rondo_server/connection/heartbeat
import rondo_server/connection/session
import rondo_server/connection/session_actor
import rondo_server/connection/sessions
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/games/veryare/room as veryare
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, CreateRoom, ErrorMessage, GameEnded,
  JoinRoom, LeaveRoom, ListRooms, RoomJoined, RoomList, RoomSummary, Session,
}
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

const divisor = 1000

/// 縮めた、観戦者が 0 人のまま閉じるまで（60 秒 / 1000）。
const idle_close_ms = 60

const grace_ms = 300

type Client {
  Client(
    socket: Subject(ServerMessage),
    actor: Subject(session_actor.Message),
    player_id: String,
  )
}

@external(erlang, "rondo_spectate_test_ffi", "put_env")
fn put_env(name: String, value: String) -> Nil

@external(erlang, "rondo_spectate_test_ffi", "unset_env")
fn unset_env(name: String) -> Nil

@external(erlang, "rondo_spectate_test_ffi", "process_count")
fn process_count() -> Int

@external(erlang, "rondo_spectate_test_ffi", "memory_of")
fn memory_of(pid: Pid) -> Int

/// このテストの間だけ、観戦ルームを受け付ける（開発用の環境変数）。終わったら外す。
fn with_spectate_dev(body: fn() -> a) -> a {
  put_env(veryare.spectate_dev_env_name, "1")
  let result = body()
  unset_env(veryare.spectate_dev_env_name)
  result
}

fn server() -> connection.Deps {
  let assert Ok(supervisor) = room_supervisor.start()
  let assert Ok(directory) =
    room_directory.start(supervisor.data, catalog.room_limits())
  let assert Ok(registry) = sessions.start()
  connection.Deps(
    session: session.Deps(
      directory: directory.data,
      timing: timing.Faster(divisor:),
    ),
    sessions: registry.data,
    grace_ms:,
    heartbeat: heartbeat.Config(interval_ms: 10_000, timeout_ms: 80),
  )
}

fn connect(deps: connection.Deps) -> Client {
  let socket = process.new_subject()
  let actor = connection.open(deps, socket)
  let assert Ok(Session(player_id:, ..)) = process.receive(socket, 500)
  Client(socket:, actor:, player_id:)
}

fn send(deps: connection.Deps, client: Client, incoming: ClientMessage) -> Nil {
  let _ = connection.receive(deps, client.actor, client.socket, incoming)
  Nil
}

/// 少し待ってから、いま届いている分だけを読む（試合を回し続けるので、届かなくなるまで待たない）。
fn drain(client: Client) -> List(ServerMessage) {
  process.sleep(30)
  do_drain(client.socket, [])
}

fn do_drain(socket, acc) {
  case process.receive(socket, 0) {
    Ok(m) -> do_drain(socket, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn spectate_settings() {
  Some(
    dynamic.properties([
      #(dynamic.string("spectate"), dynamic.int(1)),
    ]),
  )
}

/// 観戦ルームを作る。届いた電文。
fn create_spectate(
  deps: connection.Deps,
  client: Client,
) -> List(ServerMessage) {
  send(deps, client, CreateRoom("veryare", spectate_settings(), None))
  drain(client)
}

fn joined(messages: List(ServerMessage)) -> Result(ServerMessage, Nil) {
  list.find(messages, fn(m) {
    case m {
      RoomJoined(..) -> True
      _ -> False
    }
  })
}

fn error_codes(messages: List(ServerMessage)) -> List(String) {
  list.filter_map(messages, fn(m) {
    case m {
      ErrorMessage(code:, ..) -> Ok(code)
      _ -> Error(Nil)
    }
  })
}

/// count 回の game-ended が届くまで待つ（届いた回数）。
fn wait_results(client: Client, count: Int, seen: Int) -> Int {
  case seen >= count {
    True -> seen
    False ->
      case process.receive(client.socket, 2000) {
        Ok(GameEnded(..)) -> wait_results(client, count, seen + 1)
        Ok(_) -> wait_results(client, count, seen)
        Error(Nil) -> seen
      }
  }
}

fn room_pid(deps: connection.Deps, room_id: String) -> Pid {
  let assert Ok(room) = room_directory.find(deps.session.directory, room_id)
  let assert Ok(pid) = process.subject_owner(room)
  pid
}

// --- 旗 ------------------------------------------------------------------------

/// 旗も環境変数も無ければ、spectate: 1 の作成は invalid-settings で断る（本番に出さない）。
pub fn spectate_room_is_refused_without_the_flag_test() {
  unset_env(veryare.spectate_dev_env_name)
  let deps = server()
  let a = connect(deps)
  let got = create_spectate(deps, a)
  error_codes(got) |> should.equal(["invalid-settings"])
  joined(got) |> should.equal(Error(Nil))
}

// --- 試合を回す ---------------------------------------------------------------------

/// 作った人は観戦者として入る（参加者は CPU 4 体だけで、本人は載らない）。試合は人間なしで結果まで進み、
/// 同じルームで次の試合が始まる。連続 5 試合を回しても、プロセスの数とルームのメモリが増え続けない。
pub fn spectate_room_runs_five_games_without_growing_test() {
  use <- with_spectate_dev
  let deps = server()
  let a = connect(deps)
  let assert Ok(RoomJoined(room_id:, you:, players:, ..)) =
    joined(create_spectate(deps, a))
  you |> should.equal(a.player_id)
  list.map(players, fn(p) { p.name })
  |> should.equal(["CPU 1", "CPU 2", "CPU 3", "CPU 4"])
  list.any(players, fn(p) { p.player_id == a.player_id }) |> should.be_false

  let pid = room_pid(deps, room_id)
  wait_results(a, 2, 0) |> should.equal(2)
  let processes = process_count()
  let memory = memory_of(pid)
  wait_results(a, 3, 0) |> should.equal(3)
  // 同じルームのまま（作り直していない）で、枠は 1 つのまま。
  room_pid(deps, room_id) |> should.equal(pid)
  room_directory.active_count(deps.session.directory, "veryare")
  |> should.equal(1)
  { process_count() <= processes + 2 } |> should.be_true
  { memory_of(pid) <= memory * 2 } |> should.be_true
}

/// 一覧に、観戦ルームの印と、観戦者の数・上限が出る。2 人目は、join-room で観戦者として入る。
pub fn spectate_room_is_listed_with_spectators_test() {
  use <- with_spectate_dev
  let deps = server()
  let a = connect(deps)
  let assert Ok(RoomJoined(room_id:, ..)) = joined(create_spectate(deps, a))
  let b = connect(deps)
  send(deps, b, JoinRoom("veryare", room_id))
  let assert Ok(RoomJoined(you:, players:, ..)) = joined(drain(b))
  you |> should.equal(b.player_id)
  list.length(players) |> should.equal(4)

  let c = connect(deps)
  send(deps, c, ListRooms("veryare"))
  let assert Ok(RoomList(rooms:, ..)) =
    list.find(drain(c), fn(m) {
      case m {
        RoomList(..) -> True
        _ -> False
      }
    })
  let assert [RoomSummary(spectate:, player_count:, capacity:, ..)] = rooms
  spectate |> should.be_true
  player_count |> should.equal(2)
  capacity |> should.equal(20)
}

// --- 閉じる ----------------------------------------------------------------------

/// 観戦者が退出して 0 人のまま一定時間たつと、閉じ、観戦の枠が戻る。
pub fn spectate_room_closes_when_empty_test() {
  use <- with_spectate_dev
  let deps = server()
  let a = connect(deps)
  let assert Ok(RoomJoined(room_id:, ..)) = joined(create_spectate(deps, a))
  send(deps, a, LeaveRoom(room_id))
  process.sleep(idle_close_ms + 60)
  room_directory.find(deps.session.directory, room_id) |> should.be_error
  room_directory.active_count(deps.session.directory, "veryare")
  |> should.equal(0)
  // 枠が戻ったので、また作れる。
  let b = connect(deps)
  joined(create_spectate(deps, b)) |> should.be_ok
}

/// 切断しても、猶予（ここでは 300 ms）の間は、0 人と数えない（閉じない）。猶予を過ぎて離脱が確定
/// してから、0 人のまま閉じるまでの時間を数える。
pub fn disconnect_grace_keeps_the_spectator_counted_test() {
  use <- with_spectate_dev
  let deps = server()
  let a = connect(deps)
  let assert Ok(RoomJoined(room_id:, ..)) = joined(create_spectate(deps, a))
  connection.close(a.actor, a.socket)
  // 0 人で閉じる時間（60 ms）を過ぎても、猶予の間は閉じない。
  process.sleep(idle_close_ms * 3)
  room_directory.find(deps.session.directory, room_id) |> should.be_ok
  // 猶予を過ぎ、さらに 0 人のまま閉じる時間を過ぎると、閉じる。
  process.sleep(grace_ms + idle_close_ms + 100)
  room_directory.find(deps.session.directory, room_id) |> should.be_error
}
