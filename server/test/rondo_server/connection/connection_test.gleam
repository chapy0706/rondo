import gleam/dynamic
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
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
  type ClientMessage, type ServerMessage, CreateRoom, ErrorMessage, GameEvent,
  GameState, GameStateTo, JoinRoom, LeaveRoom, Ping, PlayerLeft, Pong, Reconnect,
  RoomJoined, Session,
}
import rondo_server/room/room_actor.{PlayerId}
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

// 実接続の結合テスト（issue-31 段階 6・8）。WebSocket の殻と同じ入口（connection）を通し、
// ソケットの代わりにテスト用の受け口を使って、2つ以上のクライアントを模す。

/// テスト用の短い再接続猶予（本番は 10 秒 / ADR 0013）。
const grace_ms = 400

// --- 補助 ---------------------------------------------------------------

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
    session: session.Deps(directory: directory.data, timing: timing.Normal),
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

/// ソケットに届いたものを、届き終わるまで集める。
fn drain(client: Client) -> List(ServerMessage) {
  do_drain(client.socket, [])
}

fn do_drain(socket, acc) {
  case process.receive(socket, 60) {
    Ok(m) -> do_drain(socket, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn areas(messages: List(ServerMessage)) -> List(String) {
  list.filter_map(messages, fn(m) {
    case m {
      GameState(payload:, ..) ->
        decode.run(payload, decode.field("area", decode.string, decode.success))
        |> result_to_error_nil
      _ -> Error(Nil)
    }
  })
}

fn result_to_error_nil(r: Result(a, b)) -> Result(a, Nil) {
  case r {
    Ok(v) -> Ok(v)
    Error(_) -> Error(Nil)
  }
}

fn joined_room(messages: List(ServerMessage)) -> String {
  let assert Ok(RoomJoined(room_id:, ..)) =
    list.find(messages, fn(m) {
      case m {
        RoomJoined(..) -> True
        _ -> False
      }
    })
  room_id
}

fn touch_area(room_id: String) -> ClientMessage {
  GameEvent(
    "veryare",
    room_id,
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ]),
  )
}

/// A がルームを作り、B が参加した状態にする。
fn room_with_two(deps) -> #(Client, Client, String) {
  let a = connect(deps)
  let a = send(deps, a, CreateRoom("veryare", None))
  let room_id = joined_room(drain(a))
  let b = connect(deps)
  let b = send(deps, b, JoinRoom("veryare", room_id))
  let _ = drain(a)
  let _ = drain(b)
  #(a, b, room_id)
}

/// 切断して、新しいソケットで接続し直す（まだ復帰の電文は送っていない状態）。
fn reopen(deps, old: Client) -> Client {
  connection.close(old.actor, old.socket)
  connect(deps)
}

// --- 作成 → 参加 → フェーズ通知 → 限定配信（段階 8） -------------------------------

/// 2人ともにフェーズ通知が届き、ゲーム内イベントも両方に反映される。
pub fn create_join_and_phase_notices_reach_both_test() {
  let deps = server()
  let a = connect(deps)
  let a = send(deps, a, CreateRoom("veryare", None))
  let room_id = joined_room(drain(a))

  let b = connect(deps)
  let b = send(deps, b, JoinRoom("veryare", room_id))
  areas(drain(a)) |> should.equal(["ready"])
  areas(drain(b)) |> should.equal(["ready"])

  let _ = send(deps, b, touch_area(room_id))
  areas(drain(a)) |> should.equal(["counting"])
  areas(drain(b)) |> should.equal(["counting"])
}

/// 限定配信は宛先のソケットにだけ届き、同じルームの他のソケットには一切届かない。
pub fn targeted_delivery_reaches_only_the_target_socket_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)

  let assert Ok(room) = room_directory.find(deps.session.directory, room_id)
  room_actor.send_to(room, [PlayerId(b.player_id)], dynamic.string("secret"))

  drain(a) |> should.equal([])
  let assert [GameStateTo(to:, ..)] = drain(b)
  to |> should.equal(b.player_id)
}

// --- 再接続猶予（段階 6） --------------------------------------------------------

/// 猶予内に resumeToken で再接続すると、同じプレイヤーとして同じルームに戻る。
/// 切断中に届いた通知も、復帰したソケットに届く。他の人には離脱が伝わらない。
pub fn reconnect_within_grace_resumes_same_player_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)

  let a2 = reopen(deps, a)
  // 切断中に状態が変わる（B がエリアに触れる）。
  let _ = send(deps, b, touch_area(room_id))
  let _ = drain(b)

  let a2 = send(deps, a2, Reconnect(room_id, a.resume_token))
  let received = drain(a2)
  // 元の識別子とトークンが戻り、同じルームに入っている。
  list.contains(received, Session(a.player_id, a.resume_token))
  |> should.be_true
  let assert Ok(RoomJoined(room_id: rejoined, you:, ..)) =
    list.find(received, fn(m) {
      case m {
        RoomJoined(..) -> True
        _ -> False
      }
    })
  rejoined |> should.equal(room_id)
  you |> should.equal(a.player_id)
  // 切断中の通知（青）も届く。
  areas(received) |> should.equal(["counting"])
  // B には離脱が伝わっていない。
  process.sleep(grace_ms + 100)
  drain(b) |> list.any(is_player_left) |> should.be_false

  // 復帰したプレイヤーとして、引き続きゲーム内イベントを送れる。
  let _ = send(deps, a2, touch_area(room_id))
  let assert Ok(room) = room_directory.find(deps.session.directory, room_id)
  room_actor.snapshot(room).players
  |> list.map(fn(p) { p.id })
  |> list.contains(PlayerId(a.player_id))
  |> should.be_true
}

/// 猶予を過ぎると離脱が確定し（他の人に player-left）、その後は復帰できない。
pub fn grace_expiry_confirms_leave_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)

  connection.close(b.actor, b.socket)
  // 猶予中はまだ離脱していない。
  drain(a) |> list.any(is_player_left) |> should.be_false

  process.sleep(grace_ms + 100)
  list.contains(drain(a), PlayerLeft(room_id, b.player_id)) |> should.be_true

  let b2 = connect(deps)
  let b2 = send(deps, b2, Reconnect(room_id, b.resume_token))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(b2)
}

/// 他人の resumeToken では復帰できない（つながっている人のトークン・playerId・でたらめ）。
pub fn cannot_resume_with_someone_elses_token_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  let c = connect(deps)

  // A はつながっている。A の本物のトークンでも、つながっている間は乗っ取れない。
  let c = send(deps, c, Reconnect(room_id, a.resume_token))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(c)

  // B が切断中でも、他の人にも見える playerId では復帰できない。
  connection.close(b.actor, b.socket)
  let c = send(deps, c, Reconnect(room_id, b.player_id))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(c)

  // でたらめなトークンでも復帰できない。
  let c = send(deps, c, Reconnect(room_id, "0123456789abcdef0123456789abcdef"))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(c)

  // ルーム ID が違えば、正しいトークンでも復帰できない。正しい組なら復帰できる。
  let c = send(deps, c, Reconnect("room-other", b.resume_token))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(c)
  let b2 = connect(deps)
  let b2 = send(deps, b2, Reconnect(room_id, b.resume_token))
  list.contains(drain(b2), Session(b.player_id, b.resume_token))
  |> should.be_true
  // A は乗っ取られていない（A のソケットに配信が届き続ける）。
  let _ = send(deps, b2, touch_area(room_id))
  areas(drain(a)) |> should.equal(["counting"])
}

/// 復帰した後は、古いソケットには何も届かない。
pub fn old_socket_receives_nothing_after_resume_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  let a2 = reopen(deps, a)
  let a2 = send(deps, a2, Reconnect(room_id, a.resume_token))
  let _ = drain(a2)

  let _ = send(deps, b, touch_area(room_id))
  areas(drain(a2)) |> should.equal(["counting"])
  drain(a) |> should.equal([])
}

/// ルームを退出してから切断した接続は、猶予を待たずに終わる（復帰できない）。
pub fn leaving_then_disconnecting_ends_immediately_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  let b = send(deps, b, LeaveRoom(room_id))
  list.contains(drain(a), PlayerLeft(room_id, b.player_id)) |> should.be_true

  connection.close(b.actor, b.socket)
  let b2 = connect(deps)
  let b2 = send(deps, b2, Reconnect(room_id, b.resume_token))
  let assert [ErrorMessage(code: "reconnect-failed", ..)] = drain(b2)
}

/// ルームにいない接続は、切断した時点で台帳から消える。
pub fn session_outside_room_is_removed_on_disconnect_test() {
  let deps = server()
  let a = connect(deps)
  let assert Ok(_) = sessions.lookup(deps.sessions, a.resume_token)
  connection.close(a.actor, a.socket)
  process.sleep(50)
  sessions.lookup(deps.sessions, a.resume_token) |> should.equal(Error(Nil))
}

fn is_player_left(m: ServerMessage) -> Bool {
  case m {
    PlayerLeft(..) -> True
    _ -> False
  }
}

// --- ハートビート（issue-41） ----------------------------------------------------------

/// pong は接続の層で受け取るだけで、返信も、ルームへの影響もない。
pub fn pong_is_absorbed_by_the_connection_layer_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  let a = send(deps, a, Pong)
  drain(a) |> should.equal([])
  drain(b) |> should.equal([])
  // その後もルームの電文は通る。
  let _ = send(deps, a, touch_area(room_id))
  areas(drain(b)) |> should.equal(["counting"])
}

/// 応答のない接続は、ハートビートがソケットを閉じ、猶予に入る。猶予内に戻れば同じルームで
/// 続けられ、他の人には離脱が伝わらない（ハートビートの失敗が、ルームの進行を止めない）。
pub fn silent_socket_is_closed_and_enters_grace_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  let timed_out = process.new_subject()
  let assert Ok(hb) = connection.start_heartbeat(deps, a.socket, timed_out)
  // a は何も送らない。待ち時間の後、ソケットを閉じるよう頼まれる。
  let assert Ok(Nil) = process.receive(timed_out, 500)
  process.is_alive(heartbeat.pid(hb)) |> should.be_false
  // ソケットの殻は、閉じたら接続アクターへ伝える（websocket の on_close と同じ）。
  connection.close(a.actor, a.socket)

  // 猶予の間も、b はルームで進められる。
  let _ = send(deps, b, touch_area(room_id))
  areas(drain(b)) |> should.equal(["counting"])
  drain(b) |> list.any(is_player_left) |> should.be_false

  // a は猶予内に戻れる。切断中の通知も届く。
  let a2 = connect(deps)
  let a2 = send(deps, a2, Reconnect(room_id, a.resume_token))
  let received = drain(a2)
  list.contains(received, Session(a.player_id, a.resume_token))
  |> should.be_true
  areas(received) |> should.equal(["counting"])
}

/// 切断中の一時保管に ping は入れない（復帰したときに古い ping を流さない）。
pub fn pings_are_not_buffered_while_disconnected_test() {
  let deps = server()
  let #(a, b, room_id) = room_with_two(deps)
  connection.close(a.actor, a.socket)
  process.send(a.actor, session_actor.FromRoom(Ping))
  let _ = send(deps, b, touch_area(room_id))
  let _ = drain(b)
  process.send(a.actor, session_actor.FromRoom(Ping))

  let a2 = connect(deps)
  let a2 = send(deps, a2, Reconnect(room_id, a.resume_token))
  let received = drain(a2)
  list.contains(received, Ping) |> should.be_false
  areas(received) |> should.equal(["counting"])
}

// --- ステージの通知（issue-29a） -------------------------------------------------------

fn is_stage_notice(m: ServerMessage) -> Bool {
  case m {
    GameState(payload:, ..) | GameStateTo(payload:, ..) ->
      decode.run(payload, decode.field("type", decode.string, decode.success))
      == Ok("stage")
    _ -> False
  }
}

/// ルームを作った人と、参加した人の両方に、ステージの通知が届く。
pub fn stage_notice_reaches_creator_and_joiner_test() {
  let deps = server()
  let a = connect(deps)
  let a = send(deps, a, CreateRoom("veryare", None))
  let from_a = drain(a)
  let room_id = joined_room(from_a)
  list.any(from_a, is_stage_notice) |> should.be_true
  let b = connect(deps)
  let b = send(deps, b, JoinRoom("veryare", room_id))
  list.any(drain(b), is_stage_notice) |> should.be_true
}

/// 再接続で戻ったソケットにも、ステージの通知が届き直す（リロードした画面のため）。
pub fn stage_notice_is_resent_after_reconnect_test() {
  let deps = server()
  let #(a, _b, room_id) = room_with_two(deps)
  let a2 = reopen(deps, a)
  let a2 = send(deps, a2, Reconnect(room_id, a.resume_token))
  list.any(drain(a2), is_stage_notice) |> should.be_true
}
