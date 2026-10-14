import gleam/dict
import gleam/dynamic
import gleam/erlang/process
import gleam/int
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room as veryare
import rondo_server/room/room_actor.{
  type RoomSpec, Player, PlayerId, RoomId, RoomSpec,
}
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
    veryare.Settings(40, veryare.NoCpu, oni_cpu.Normal),
  )
}

fn other_spec(n: Int) -> RoomSpec {
  RoomSpec(
    id: RoomId("t" <> int.to_string(n)),
    game_type: "tilt-maze",
    name: "test",
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

// --- 終わったルーム（issue-51 の上限の試験で見つかった問題） --------------------------------

/// 3つのうち1つのゲームが終わる（不成立）と、人が残っていても、4つ目を作れる。終わったルームは、
/// 同時ルーム数に数えない。終わったルームは、ID で引けるまま（残っている人の退出などのため）。
pub fn finished_room_does_not_count_toward_the_limit_test() {
  let dir = directory()
  let quick =
    veryare.spec_with(
      RoomId("quick"),
      veryare.Settings(40, veryare.NoCpu, oni_cpu.Normal),
      game.Durations(
        oni_selection_ms: 30,
        preparation_ms: 30,
        painting_ms: 30,
        exploration_ms: 30,
        reveal_ms: 30,
        reload_ms: 30,
      ),
      fn(_) { 0 },
    )
  let assert Ok(room) = room_directory.open(dir, quick)
  list.each([2, 3], fn(n) {
    let assert Ok(_) = room_directory.open(dir, veryare_spec(n))
  })
  let assert Error(LimitReached) = room_directory.open(dir, veryare_spec(4))

  // 2人で始め、a が立候補し、b が抜ける → カウントの終わりに不成立で終わる（a は残る）。
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("a"), "a"))
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("b"), "b"))
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), touch())
  room_actor.leave(room, PlayerId("b"))
  wait_until_finished(room, 50)

  room_directory.active_count(dir, veryare.game_type) |> should.equal(2)
  let assert Ok(_) = room_directory.open(dir, veryare_spec(4))
  room_directory.find(dir, "quick") |> should.be_ok
}

fn touch() {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(0.0)),
    #(dynamic.string("z"), dynamic.float(0.0)),
  ])
}

fn wait_until_finished(room, tries: Int) -> Nil {
  case room_actor.snapshot(room).status, tries {
    room_actor.Finished, _ -> {
      // 台帳へ知らせが届くまで、少し待つ。
      process.sleep(20)
      Nil
    }
    _, 0 -> panic as "ルームが終わらない"
    _, _ -> {
      process.sleep(20)
      wait_until_finished(room, tries - 1)
    }
  }
}
