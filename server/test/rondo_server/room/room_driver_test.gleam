import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{
  type Message, type PlayerId, Finished, Open, Player, PlayerId, Playing, RoomId,
  RoomSpec,
}

/// ゲーム進行の差し込み口（room/driver）を、最小の仮のゲームで確かめる。
///
/// 仮のゲームは、受けたものをそのまま全員へ流す。"secret" イベントは送り主にだけ返す。
/// "end" イベントか、誰かの離脱で終わる。開始時に 10ms 後のタイマーを1本張る。
fn text(value: String) -> Dynamic {
  dynamic.string(value)
}

fn echo_driver(over: Bool) -> Driver(PlayerId) {
  driver.new(
    on_event: fn(player, payload) {
      case payload == text("end"), payload == text("secret") {
        True, _ -> #(echo_driver(True), [driver.Broadcast(text("ended"))])
        _, True -> #(echo_driver(over), [driver.Deliver([player], payload)])
        _, _ -> #(echo_driver(over), [driver.Broadcast(payload)])
      }
    },
    on_leave: fn(_player) {
      #(echo_driver(True), [driver.Broadcast(text("left"))])
    },
    on_wake: fn(token) {
      case token {
        7 -> #(echo_driver(over), [driver.Broadcast(text("woke"))])
        _ -> #(echo_driver(over), [])
      }
    },
    is_over: fn() { over },
  )
}

fn start_echo(
  _players: List(PlayerId),
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  #(echo_driver(False), [driver.WakeAfter(10, 7)])
}

fn open_room(min: Int, ids: List(String)) -> #(Subject(Message), process.Pid) {
  let spec =
    RoomSpec(
      id: RoomId("r"),
      game_type: "echo",
      min_players: min,
      max_players: 5,
      authority: None,
      driver: Some(start_echo),
      member_info: Some(text("welcome")),
    )
  let assert Ok(started) = room_actor.start(spec)
  list.each(ids, fn(id) {
    let assert Ok(Nil) = room_actor.join(started.data, Player(PlayerId(id), id))
  })
  #(started.data, started.pid)
}

fn subscribe(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  room_actor.subscribe(room, PlayerId(id), outbox)
  outbox
}

fn settle(room: Subject(Message)) -> Nil {
  let _ = room_actor.snapshot(room)
  Nil
}

fn broadcast(payload: String) -> ServerMessage {
  GameState(game_type: "echo", room_id: "r", payload: text(payload))
}

/// 参加者は購読した時点で、入室後の案内（ルーム一覧には出さない情報）を受け取る。
pub fn member_receives_room_info_on_subscribe_test() {
  let #(room, _) = open_room(2, ["a", "b"])
  let a = subscribe(room, "a")
  settle(room)
  process.receive(a, 0) |> should.equal(Ok(broadcast("welcome")))
}

/// 参加していない接続には、入室後の案内も送らない。
pub fn outsider_receives_no_room_info_test() {
  let #(room, _) = open_room(2, ["a"])
  let outsider = subscribe(room, "outsider")
  settle(room)
  process.receive(outsider, 0) |> should.equal(Error(Nil))
}

/// 全員宛ての指示は購読者全員に、宛先付きの指示は宛先にだけ届く。
pub fn broadcast_reaches_all_and_deliver_reaches_target_only_test() {
  let #(room, _) = open_room(2, ["a", "b"])
  let a = subscribe(room, "a")
  let b = subscribe(room, "b")
  let _ = process.receive(a, 0)
  let _ = process.receive(b, 0)
  settle(room)
  let _ = process.receive(a, 0)
  let _ = process.receive(b, 0)

  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), text("hello"))
  room_actor.game_event(room, PlayerId("b"), text("secret"))
  settle(room)

  process.receive(a, 0) |> should.equal(Ok(broadcast("hello")))
  process.receive(b, 0) |> should.equal(Ok(broadcast("hello")))
  process.receive(b, 0)
  |> should.equal(
    Ok(GameStateTo(
      game_type: "echo",
      room_id: "r",
      to: "b",
      payload: text("secret"),
    )),
  )
  process.receive(a, 0) |> should.equal(Error(Nil))
}

/// ゲームが頼んだタイマーは、指定の時間後に同じ合図でゲームに戻ってくる。
pub fn wake_after_calls_back_the_game_test() {
  let #(room, _) = open_room(2, ["a", "b"])
  let a = subscribe(room, "a")
  let assert Ok(_) = process.receive(a, 100)

  let assert Ok(Nil) = room_actor.start_game(room)
  process.receive(a, 200) |> should.equal(Ok(broadcast("woke")))
}

/// ゲームが終われば Finished になる。
pub fn game_over_marks_room_finished_test() {
  let #(room, _) = open_room(2, ["a", "b"])
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), text("end"))
  room_actor.snapshot(room).status |> should.equal(Finished)
}

/// 進行中に最小人数を割っても、ルームは止めずにゲームへ判断を委ねる（veryare の勝敗のため）。
pub fn leave_below_min_is_delegated_to_the_game_test() {
  let #(room, pid) = open_room(2, ["a", "b"])
  let b = subscribe(room, "b")
  let assert Ok(Nil) = room_actor.start_game(room)
  settle(room)
  let _ = process.receive(b, 0)

  room_actor.leave(room, PlayerId("a"))
  settle(room)

  process.is_alive(pid) |> should.be_true
  process.receive(b, 0) |> should.equal(Ok(broadcast("left")))
  room_actor.snapshot(room).status |> should.equal(Finished)
}

/// 最初に入ったプレイヤーがホストになる。ホストが抜けてもルームは続き、
/// 残ったプレイヤーで遊べる（ADR 0030）。
pub fn host_leaving_keeps_room_usable_test() {
  let #(room, pid) = open_room(2, ["host", "b"])
  room_actor.snapshot(room).host |> should.equal(Some(PlayerId("host")))

  room_actor.leave(room, PlayerId("host"))
  settle(room)
  process.is_alive(pid) |> should.be_true
  room_actor.snapshot(room).status |> should.equal(Open)

  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("c"), "c"))
  room_actor.start_game(room) |> should.equal(Ok(Nil))
  room_actor.snapshot(room).status |> should.equal(Playing)
}
