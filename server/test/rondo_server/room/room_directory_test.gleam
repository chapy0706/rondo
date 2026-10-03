import gleam/dict
import gleam/erlang/process
import gleam/int
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/games/veryare/room as veryare
import rondo_server/room/room_actor.{type RoomSpec, RoomId, RoomSpec}
import rondo_server/room/room_directory.{LimitReached}
import rondo_server/room/room_supervisor

fn directory() {
  let assert Ok(supervisor) = room_supervisor.start()
  let limits = dict.from_list([#(veryare.game_type, veryare.max_active_rooms)])
  let assert Ok(started) = room_directory.start(supervisor.data, limits)
  started.data
}

fn veryare_spec(n: Int) -> RoomSpec {
  veryare.spec(
    RoomId("v" <> int.to_string(n)),
    veryare.Settings(40, veryare.NoCpu),
  )
}

fn other_spec(n: Int) -> RoomSpec {
  RoomSpec(
    id: RoomId("t" <> int.to_string(n)),
    game_type: "tilt-maze",
    min_players: 2,
    max_players: 4,
    authority: None,
    driver: None,
    member_info: None,
    bots: [],
  )
}

/// veryare は同時に3つまで。4つ目の作成は拒否される（ADR 0030）。
pub fn fourth_veryare_room_is_rejected_test() {
  let dir = directory()
  list.each([1, 2, 3], fn(n) {
    let assert Ok(_) = room_directory.open(dir, veryare_spec(n))
  })
  room_directory.active_count(dir, veryare.game_type) |> should.equal(3)

  let assert Error(LimitReached) = room_directory.open(dir, veryare_spec(4))
  room_directory.active_count(dir, veryare.game_type) |> should.equal(3)
}

/// 上限を持たない種別（Tilt Maze 等）は、veryare の上限に影響されない。
pub fn other_game_types_are_not_limited_test() {
  let dir = directory()
  list.each([1, 2, 3], fn(n) {
    let assert Ok(_) = room_directory.open(dir, veryare_spec(n))
  })
  list.each([1, 2, 3, 4, 5], fn(n) {
    let assert Ok(_) = room_directory.open(dir, other_spec(n))
  })
  room_directory.active_count(dir, "tilt-maze") |> should.equal(5)
}

/// ルームが解散すれば数が減り、また作れるようになる。
pub fn dissolved_room_frees_a_slot_test() {
  let dir = directory()
  let assert Ok(first) = room_directory.open(dir, veryare_spec(1))
  let assert Ok(_) = room_directory.open(dir, veryare_spec(2))
  let assert Ok(_) = room_directory.open(dir, veryare_spec(3))

  room_actor.dissolve(first)
  process.sleep(30)

  room_directory.active_count(dir, veryare.game_type) |> should.equal(2)
  let assert Ok(_) = room_directory.open(dir, veryare_spec(4))
}
