import gleam/erlang/process
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/room/room_actor.{
  type Player, type RoomSpec, AlreadyPlaying, GameAlreadyStarted,
  NotEnoughPlayers, Open, Player, PlayerId, Playing, RoomFull, RoomId, RoomSpec,
}

fn spec(min: Int, max: Int) -> RoomSpec {
  RoomSpec(id: RoomId("r"), min_players: min, max_players: max, authority: None)
}

fn player(id: String) -> Player {
  Player(id: PlayerId(id), name: id)
}

/// 作成直後は Open で無人。
pub fn creates_open_and_empty_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let state = room_actor.snapshot(started.data)

  state.status |> should.equal(Open)
  state.players |> list.length |> should.equal(0)
}

/// 参加でプレイヤーが増える。
pub fn join_adds_player_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u2")) |> should.equal(Ok(Nil))

  room_actor.snapshot(room).players |> list.length |> should.equal(2)
}

/// 重複参加は断る。
pub fn join_duplicate_rejected_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u1"))
  |> should.equal(Error(room_actor.AlreadyJoined))
}

/// 定員を超える参加は断る。
pub fn join_full_rejected_test() {
  let assert Ok(started) = room_actor.start(spec(1, 2))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u2")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u3")) |> should.equal(Error(RoomFull))
}

/// 最小人数に満たなければ開始できない。
pub fn start_requires_min_players_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.start_game(room) |> should.equal(Error(NotEnoughPlayers))

  room_actor.join(room, player("u2")) |> should.equal(Ok(Nil))
  room_actor.start_game(room) |> should.equal(Ok(Nil))

  room_actor.snapshot(room).status |> should.equal(Playing)
  // 二重開始は断る。
  room_actor.start_game(room) |> should.equal(Error(AlreadyPlaying))
}

/// 開始後の途中参加は断る。
pub fn join_after_start_rejected_test() {
  let assert Ok(started) = room_actor.start(spec(1, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.start_game(room) |> should.equal(Ok(Nil))

  room_actor.join(room, player("u2"))
  |> should.equal(Error(GameAlreadyStarted))
}

/// 開始前なら最小人数を下回っても在室のまま続く。
pub fn leave_before_start_keeps_room_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u2")) |> should.equal(Ok(Nil))
  room_actor.leave(room, PlayerId("u2"))

  room_actor.snapshot(room).players |> list.length |> should.equal(1)
}

/// 進行中に最小人数を下回るとゲームが終了し、ルームは解散する（ADR 0013 / 0017）。
pub fn leave_below_min_dissolves_test() {
  let assert Ok(started) = room_actor.start(spec(2, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))
  room_actor.join(room, player("u2")) |> should.equal(Ok(Nil))
  room_actor.start_game(room) |> should.equal(Ok(Nil))

  room_actor.leave(room, PlayerId("u2"))
  process.sleep(30)

  process.is_alive(started.pid) |> should.be_false
}

/// 最後の一人が抜けたら解散する。
pub fn leave_last_dissolves_test() {
  let assert Ok(started) = room_actor.start(spec(1, 4))
  let room = started.data

  room_actor.join(room, player("u1")) |> should.equal(Ok(Nil))

  room_actor.leave(room, PlayerId("u1"))
  process.sleep(30)

  process.is_alive(started.pid) |> should.be_false
}
