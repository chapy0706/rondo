import gleam/erlang/process
import gleam/option.{None}
import gleeunit/should
import rondo_server/room/room_actor.{
  type RoomSpec, Player, PlayerId, RoomId, RoomSpec,
}
import rondo_server/room/room_supervisor

fn spec(id: String) -> RoomSpec {
  RoomSpec(
    id: RoomId(id),
    game_type: "test",
    name: "test",
    min_players: 1,
    max_players: 4,
    authority: None,
    driver: None,
    member_info: None,
    bots: [],
  )
}

/// 起動直後は監視下のルームが無い。
pub fn starts_with_no_rooms_test() {
  let assert Ok(sup) = room_supervisor.start()
  room_supervisor.room_count(sup.pid) |> should.equal(0)
}

/// ルームを生成でき、監視下に入る。
pub fn open_room_test() {
  let assert Ok(sup) = room_supervisor.start()

  let assert Ok(room) = room_supervisor.open_room(sup.data, spec("a"))
  process.is_alive(room.pid) |> should.be_true

  // 生成したルームは実際に使える。
  room_actor.join(room.data, Player(PlayerId("u1"), "u1"))
  |> should.equal(Ok(Nil))

  room_supervisor.room_count(sup.pid) |> should.equal(1)
}

/// 複数ルームを同時に監視できる。
pub fn open_multiple_rooms_test() {
  let assert Ok(sup) = room_supervisor.start()

  let assert Ok(_) = room_supervisor.open_room(sup.data, spec("a"))
  let assert Ok(_) = room_supervisor.open_room(sup.data, spec("b"))

  room_supervisor.room_count(sup.pid) |> should.equal(2)
}

/// 解散（正常終了）したルームは監視から外れ、他のルームは残る。
pub fn dissolved_room_leaves_supervision_test() {
  let assert Ok(sup) = room_supervisor.start()
  let assert Ok(room_a) = room_supervisor.open_room(sup.data, spec("a"))
  let assert Ok(_) = room_supervisor.open_room(sup.data, spec("b"))

  room_actor.dissolve(room_a.data)
  process.sleep(30)

  // 正常終了は Transient で再起動されない。
  room_supervisor.room_count(sup.pid) |> should.equal(1)
  process.is_alive(sup.pid) |> should.be_true
}

/// ルームが異常終了しても、スーパーバイザーは巻き込まれない。落ちたルームは作り直さない
/// （Temporary / ADR 0047。ADR 0006 の「回復させる」を、ルームについて置き換える）。ほかのルームは残る。
pub fn crashed_room_is_not_restarted_test() {
  let assert Ok(sup) = room_supervisor.start()
  let assert Ok(room) = room_supervisor.open_room(sup.data, spec("a"))
  let assert Ok(other) = room_supervisor.open_room(sup.data, spec("b"))

  room_supervisor.room_count(sup.pid) |> should.equal(2)

  // 異常終了させる。スーパーバイザーは生きたまま、落ちたルームだけが消える。
  process.kill(room.pid)
  process.sleep(50)

  process.is_alive(sup.pid) |> should.be_true
  process.is_alive(other.pid) |> should.be_true
  room_supervisor.room_count(sup.pid) |> should.equal(1)
}
