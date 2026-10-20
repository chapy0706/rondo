//// 終わったルームの自動閉鎖（issue-70 / ADR 0050）。接続の入口（connection）を通した結合テスト。
////
//// フェーズ時間と、閉じるまでの時間（3 分）を 1/1000 に縮めて（RONDO_TEST_PHASE_DIVISOR と同じ仕組み）、
//// veryare のゲームを最後まで進める。
////
//// - 結果が確定してから、閉じるまでの時間がたつと、残っている全員に room-expired が届き、ルームが閉じる
////   （落ちたときの room-closed は届かない）。閉じたルームは、台帳に残らず、同時ルーム数にも数えない
//// - game-ended には、閉じるまでの残り（closesInMs）が載る。結果のあとに戻った人にも、残りつきで送り直す
//// - 閉じたルームの復帰トークンでは、戻れない（reconnect-failed）
//// - 進行中のルーム（結果が出る前）は、閉じない
//// - 参加者が全員退出したときの動き（解散。room-expired も room-closed も届かない）は変わらない

import gleam/dynamic
import gleam/erlang/process.{type Subject}
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
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, CreateRoom, ErrorMessage, GameEnded,
  GameEvent, JoinRoom, LeaveRoom, Reconnect, RoomJoined, Session,
}
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

/// フェーズ時間と、閉じるまでの時間を割る数。閉じるまでは 180 ms。
const divisor = 1000

const close_ms = 180

const grace_ms = 2000

type Client {
  Client(
    socket: Subject(ServerMessage),
    actor: Subject(session_actor.Message),
    player_id: String,
    resume_token: String,
  )
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
  let assert Ok(Session(player_id:, resume_token:)) =
    process.receive(socket, 500)
  Client(socket:, actor:, player_id:, resume_token:)
}

fn send(
  deps: connection.Deps,
  client: Client,
  incoming: ClientMessage,
) -> Client {
  let actor = connection.receive(deps, client.actor, client.socket, incoming)
  Client(..client, actor:)
}

fn drain(client: Client) -> List(ServerMessage) {
  do_drain(client.socket, 60, [])
}

fn do_drain(socket, wait, acc) {
  case process.receive(socket, wait) {
    Ok(m) -> do_drain(socket, wait, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

/// pred に当たる電文が届くまで待つ（timeout ミリ秒まで）。当たった電文。
fn wait_for(
  client: Client,
  timeout: Int,
  pred: fn(ServerMessage) -> Bool,
) -> Result(ServerMessage, Nil) {
  case process.receive(client.socket, timeout) {
    Ok(m) ->
      case pred(m) {
        True -> Ok(m)
        False -> wait_for(client, timeout, pred)
      }
    Error(Nil) -> Error(Nil)
  }
}

fn is_game_ended(m: ServerMessage) -> Bool {
  case m {
    GameEnded(..) -> True
    _ -> False
  }
}

fn error_codes(messages: List(ServerMessage)) -> List(String) {
  list.filter_map(messages, fn(m) {
    case m {
      ErrorMessage(code:, ..) -> Ok(code)
      _ -> Error(Nil)
    }
  })
}

fn joined_room(messages: List(ServerMessage)) -> Result(String, Nil) {
  list.find_map(messages, fn(m) {
    case m {
      RoomJoined(room_id:, ..) -> Ok(room_id)
      _ -> Error(Nil)
    }
  })
}

/// a が作り、b が入った veryare のルーム。
fn room_with_two(deps: connection.Deps) -> #(Client, Client, String) {
  let a = connect(deps)
  let _ = send(deps, a, CreateRoom("veryare", None, None))
  let assert Ok(room_id) = joined_room(drain(a))
  let b = connect(deps)
  let _ = send(deps, b, JoinRoom("veryare", room_id))
  let _ = drain(a)
  let _ = drain(b)
  #(a, b, room_id)
}

/// a が鬼希望エリアの中央に触れて、ゲームを進める（時間を縮めているので、すぐ結果まで進む）。
fn play_to_the_end(deps: connection.Deps, a: Client, room_id: String) -> Nil {
  let touch =
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ])
  let _ = send(deps, a, GameEvent("veryare", room_id, touch))
  Nil
}

// --- 閉じる ----------------------------------------------------------------------

/// 結果が確定すると、game-ended に閉じるまでの残り（まるごと）が載る。時間がたつと、全員に room-expired
/// が届き、ルームは台帳から消え、同時ルーム数にも数えない。入っているルームが外れ、新しいルームを作れる。
pub fn finished_room_expires_and_notifies_everyone_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  play_to_the_end(deps, a, room_id)

  let assert Ok(GameEnded(closes_in_ms:, ..)) = wait_for(a, 2000, is_game_ended)
  closes_in_ms |> should.equal(Some(close_ms))
  let assert Ok(GameEnded(..)) = wait_for(b, 2000, is_game_ended)
  // 結果のすぐあとは、まだ閉じていない（台帳にある）。
  room_directory.find(deps.session.directory, room_id) |> should.be_ok

  process.sleep(close_ms + 100)
  error_codes(drain(a)) |> should.equal(["room-expired"])
  error_codes(drain(b)) |> should.equal(["room-expired"])
  room_directory.find(deps.session.directory, room_id) |> should.be_error
  room_directory.active_count(deps.session.directory, "veryare")
  |> should.equal(0)
  room_directory.rooms(deps.session.directory, "veryare") |> should.equal([])

  // 入っているルームは外れている（already-in-room にならず、新しいルームを作れる）。
  let _ = send(deps, a, CreateRoom("veryare", None, None))
  let made = drain(a)
  error_codes(made) |> should.equal([])
  joined_room(made) |> should.be_ok
}

/// 閉じたルームの復帰トークンでは、戻れない。切断している間に閉じたら、接続は終わり、戻ってきた接続は
/// reconnect-failed で断られる。
pub fn expired_room_refuses_resume_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  play_to_the_end(deps, a, room_id)
  let assert Ok(GameEnded(..)) = wait_for(b, 2000, is_game_ended)

  connection.close(b.actor, b.socket)
  process.sleep(close_ms + 100)
  error_codes(drain(a)) |> should.equal(["room-expired"])

  let back = connect(deps)
  let _ = send(deps, back, Reconnect(room_id, b.resume_token))
  error_codes(drain(back)) |> should.equal(["reconnect-failed"])
}

/// 結果のあとに戻った人には、結果を、閉じるまでの残りつきで送り直す（残りは、まるごとより少ない）。
pub fn resumed_member_gets_the_result_with_remaining_time_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  play_to_the_end(deps, a, room_id)
  let assert Ok(GameEnded(..)) = wait_for(b, 2000, is_game_ended)

  connection.close(b.actor, b.socket)
  process.sleep(40)
  let back = connect(deps)
  let _ = send(deps, back, Reconnect(room_id, b.resume_token))
  let assert Ok(GameEnded(closes_in_ms: Some(left), ..)) =
    wait_for(back, 500, is_game_ended)
  { left > 0 && left < close_ms } |> should.be_true
}

// --- 閉じない ----------------------------------------------------------------------

/// 進行中のルーム（結果が出る前）は、閉じるまでの時間がたっても閉じない。
pub fn running_room_is_not_closed_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  // ゲームを進めない（鬼選出のまま）。
  process.sleep(close_ms * 2)
  error_codes(drain(a)) |> should.equal([])
  error_codes(drain(b)) |> should.equal([])
  room_directory.find(deps.session.directory, room_id) |> should.be_ok
}

/// 結果のあと、参加者が全員退出すれば、これまでどおり、すぐ解散する（room-expired も room-closed も
/// 届かない。閉じるタイマーが残っていても、何も起きない）。
pub fn everyone_leaving_after_the_result_dissolves_as_before_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  play_to_the_end(deps, a, room_id)
  let assert Ok(GameEnded(..)) = wait_for(a, 2000, is_game_ended)
  let assert Ok(GameEnded(..)) = wait_for(b, 2000, is_game_ended)

  let _ = send(deps, a, LeaveRoom(room_id))
  let _ = send(deps, b, LeaveRoom(room_id))
  process.sleep(50)
  room_directory.find(deps.session.directory, room_id) |> should.be_error
  process.sleep(close_ms + 50)
  error_codes(drain(a)) |> should.equal([])
  error_codes(drain(b)) |> should.equal([])
}
