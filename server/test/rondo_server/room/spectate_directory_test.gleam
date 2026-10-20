//// 観戦ルームの枠（issue-67 / ADR 0051）。同時ルーム数は 4。人間用の枠は 3 のまま、観戦ルームは、
//// そのうち最大 1 つ（別の枠で数える）。

import gleam/dict
import gleam/erlang/process
import gleam/int
import gleam/list
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room as veryare
import rondo_server/room/room_actor.{
  type RoomSpec, RoomId, Spectate, SpectateConfig,
}
import rondo_server/room/room_directory.{LimitReached}
import rondo_server/room/room_supervisor

fn directory() {
  let assert Ok(supervisor) = room_supervisor.start()
  let limits = dict.from_list([#(veryare.game_type, veryare.max_active_rooms)])
  let assert Ok(started) = room_directory.start(supervisor.data, limits)
  started.data
}

fn match_spec(n: Int) -> RoomSpec {
  veryare.spec(
    RoomId("v" <> int.to_string(n)),
    veryare.Settings(40, veryare.NoCpu, oni_cpu.Normal),
  )
}

fn spectate_spec(n: Int) -> RoomSpec {
  veryare.spectate_spec_with(
    RoomId("s" <> int.to_string(n)),
    veryare.SpectateSettings(3, 40, veryare.RandomLayout),
    // 試合は始めない（作るだけ）ので、長さはどれでもよい。
    game.durations(exploration_ms: 40_000),
    fn(size) { 1 % size },
    fn() { 0 },
  )
}

/// 閉じるまでが長い観戦ルーム（このテストの間に、0 人で閉じない）。
fn spectate() {
  Spectate(SpectateConfig(
    max_spectators: 20,
    next_game_ms: 10_000,
    idle_close_ms: 60_000,
  ))
}

/// 人間用の枠は 3 のまま。veryare の上限の値も変えない。
pub fn match_limit_stays_three_test() {
  veryare.max_active_rooms |> should.equal(3)
  room_directory.max_spectate_rooms |> should.equal(1)
}

/// 人間 3 つ + 観戦 1 つ（合わせて 4）。5 つ目は、人間も観戦も断られる。
pub fn three_matches_and_one_spectate_room_fill_the_four_slots_test() {
  let dir = directory()
  list.each([1, 2, 3], fn(n) {
    let assert Ok(_) = room_directory.open(dir, match_spec(n))
  })
  let assert Ok(_) = room_directory.open_with(dir, spectate_spec(1), spectate())
  room_directory.active_count(dir, veryare.game_type) |> should.equal(4)

  let assert Error(LimitReached) = room_directory.open(dir, match_spec(4))
  let assert Error(LimitReached) =
    room_directory.open_with(dir, spectate_spec(2), spectate())
  room_directory.active_count(dir, veryare.game_type) |> should.equal(4)
}

/// 人間のルームが 3 つあるとき、4 つ目の人間のルームは断られる（観戦の枠が空いていても）。
pub fn fourth_match_room_is_refused_even_with_the_spectate_slot_free_test() {
  let dir = directory()
  list.each([1, 2, 3], fn(n) {
    let assert Ok(_) = room_directory.open(dir, match_spec(n))
  })
  let assert Error(LimitReached) = room_directory.open(dir, match_spec(4))
  // 観戦ルームは、まだ作れる。
  let assert Ok(_) = room_directory.open_with(dir, spectate_spec(1), spectate())
}

/// 観戦ルームが 1 つあるとき、2 つ目の観戦ルームは断られる（人間用の枠が空いていても）。
pub fn second_spectate_room_is_refused_test() {
  let dir = directory()
  let assert Ok(_) = room_directory.open_with(dir, spectate_spec(1), spectate())
  let assert Error(LimitReached) =
    room_directory.open_with(dir, spectate_spec(2), spectate())
  // 人間のルームは、まだ作れる。
  let assert Ok(_) = room_directory.open(dir, match_spec(1))
}

/// 観戦ルームが閉じると、観戦の枠が戻る。
pub fn closing_the_spectate_room_frees_the_slot_test() {
  let dir = directory()
  let assert Ok(room) =
    room_directory.open_with(dir, spectate_spec(1), spectate())
  room_actor.dissolve(room)
  process.sleep(50)
  room_directory.active_count(dir, veryare.game_type) |> should.equal(0)
  let assert Ok(_) = room_directory.open_with(dir, spectate_spec(2), spectate())
}
