import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/option.{None}
import gleeunit/should
import rondo_server/protocol/message.{type ServerMessage, GameStateTo}
import rondo_server/room/room_actor.{
  type Message, Player, PlayerId, RoomId, RoomSpec,
}

/// 宛先を選んだ配信（ADR 0021）のテスト。
///
/// ルームが送信を終えたことは、同期呼び出しの snapshot を挟んで保証する。
/// その後に受信箱を待ち時間 0 で覗き、空であれば「送られていない」と判定する。
fn open_room(ids: List(String)) -> Subject(Message) {
  let spec =
    RoomSpec(
      id: RoomId("r"),
      game_type: "chameleon",
      min_players: 1,
      max_players: 8,
      authority: None,
      driver: None,
      member_info: None,
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data
  join_all(room, ids)
  room
}

fn join_all(room: Subject(Message), ids: List(String)) -> Nil {
  case ids {
    [] -> Nil
    [id, ..rest] -> {
      let assert Ok(Nil) = room_actor.join(room, Player(PlayerId(id), id))
      join_all(room, rest)
    }
  }
}

fn subscribe(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  room_actor.subscribe(room, PlayerId(id), outbox)
  outbox
}

/// ルームがそれまでのメッセージを処理し終えるのを待つ。
fn settle(room: Subject(Message)) -> Nil {
  let _ = room_actor.snapshot(room)
  Nil
}

fn secret() -> Dynamic {
  dynamic.string("hider-positions")
}

fn nothing_sent(outbox: Subject(ServerMessage)) -> Nil {
  process.receive(outbox, 0) |> should.equal(Error(Nil))
}

/// 宛先のプレイヤーには、本人の ID を to に持つ限定配信が届く。
pub fn target_receives_message_addressed_to_itself_test() {
  let room = open_room(["seeker", "hider"])
  let hider = subscribe(room, "hider")

  room_actor.send_to(room, [PlayerId("hider")], secret())
  settle(room)

  process.receive(hider, 0)
  |> should.equal(
    Ok(GameStateTo(
      game_type: "chameleon",
      room_id: "r",
      to: "hider",
      payload: secret(),
    )),
  )
}

/// コア: 宛先でないプレイヤーの接続には、限定配信を一切送らない。
pub fn non_target_connection_receives_nothing_test() {
  let room = open_room(["seeker", "hider", "spectator"])
  let seeker = subscribe(room, "seeker")
  let hider = subscribe(room, "hider")
  let spectator = subscribe(room, "spectator")

  room_actor.send_to(room, [PlayerId("hider")], secret())
  settle(room)

  let assert Ok(_) = process.receive(hider, 0)
  nothing_sent(seeker)
  nothing_sent(spectator)
}

/// 複数の宛先には1通ずつ送り、to には受け取る本人の ID だけが入る
/// （他の宛先の ID を漏らさない）。宛先でない接続には送らない。
pub fn multiple_targets_each_get_own_copy_test() {
  let room = open_room(["seeker", "a", "b"])
  let seeker = subscribe(room, "seeker")
  let a = subscribe(room, "a")
  let b = subscribe(room, "b")

  room_actor.send_to(room, [PlayerId("a"), PlayerId("b")], secret())
  settle(room)

  let assert Ok(GameStateTo(to: to_a, ..)) = process.receive(a, 0)
  let assert Ok(GameStateTo(to: to_b, ..)) = process.receive(b, 0)
  to_a |> should.equal("a")
  to_b |> should.equal("b")
  nothing_sent(a)
  nothing_sent(b)
  nothing_sent(seeker)
}

/// 宛先が重複していても、1人には1通だけ送る。
pub fn duplicate_targets_send_once_test() {
  let room = open_room(["a"])
  let a = subscribe(room, "a")

  room_actor.send_to(room, [PlayerId("a"), PlayerId("a")], secret())
  settle(room)

  let assert Ok(_) = process.receive(a, 0)
  nothing_sent(a)
}

/// 宛先が空なら、誰にも送らない。
pub fn empty_targets_send_nothing_test() {
  let room = open_room(["a", "b"])
  let a = subscribe(room, "a")
  let b = subscribe(room, "b")

  room_actor.send_to(room, [], secret())
  settle(room)

  nothing_sent(a)
  nothing_sent(b)
}

/// 参加していないプレイヤーは送信先を登録できず、宛先にされても受け取らない。
pub fn non_member_cannot_subscribe_test() {
  let room = open_room(["a"])
  let outsider = subscribe(room, "outsider")

  room_actor.send_to(room, [PlayerId("outsider")], secret())
  settle(room)

  nothing_sent(outsider)
}

/// 離脱したプレイヤーの送信先は消え、宛先にされても送らない。
pub fn left_player_receives_nothing_test() {
  let room = open_room(["a", "b"])
  let b = subscribe(room, "b")

  room_actor.leave(room, PlayerId("b"))
  room_actor.send_to(room, [PlayerId("b")], secret())
  settle(room)

  nothing_sent(b)
}

/// 登録し直すと送信先が置き換わる（再接続 / ADR 0013）。古い接続には送らない。
pub fn resubscribe_replaces_outbox_test() {
  let room = open_room(["a"])
  let old = subscribe(room, "a")
  let new = subscribe(room, "a")

  room_actor.send_to(room, [PlayerId("a")], secret())
  settle(room)

  nothing_sent(old)
  let assert Ok(_) = process.receive(new, 0)
}
