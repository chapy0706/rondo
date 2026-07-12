import gleam/dynamic.{type Dynamic}
import gleam/option.{Some}
import gleeunit/should
import rondo_server/games/tilt_maze/authority as tilt_maze
import rondo_server/room/authority.{Outcome, Ranking}
import rondo_server/room/room_actor.{
  Finished, Player, PlayerId, Playing, RoomId, RoomSpec,
}

fn goal(level: Int) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("goal")),
    #(dynamic.string("level"), dynamic.int(level)),
  ])
}

/// ルームに tilt_maze の権威を載せ、複数プレイヤーのゴールが受信順で順位化される
/// ことと、開始から終了までが管理されることを確かめる（ADR 0008 / 0014）。
pub fn room_ranks_goals_in_receive_order_test() {
  let spec =
    RoomSpec(
      id: RoomId("r"),
      min_players: 2,
      max_players: 4,
      authority: Some(tilt_maze.create),
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data

  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("a"), "a"))
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("b"), "b"))
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.snapshot(room).status |> should.equal(Playing)

  // b が先に、次に a が最終面をクリア（この順が受信順）。
  room_actor.game_event(room, PlayerId("b"), goal(10))
  room_actor.game_event(room, PlayerId("a"), goal(10))

  let state = room_actor.snapshot(room)
  state.status |> should.equal(Finished)
  state.result
  |> should.equal(
    Some(Outcome([Ranking(PlayerId("b"), 1), Ranking(PlayerId("a"), 2)])),
  )
}

/// 全員が完走するまではゲームは続く。
pub fn room_stays_playing_until_all_finish_test() {
  let spec =
    RoomSpec(
      id: RoomId("r2"),
      min_players: 2,
      max_players: 4,
      authority: Some(tilt_maze.create),
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data

  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("a"), "a"))
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("b"), "b"))
  let assert Ok(Nil) = room_actor.start_game(room)

  room_actor.game_event(room, PlayerId("a"), goal(10))
  let state = room_actor.snapshot(room)
  state.status |> should.equal(Playing)
  state.result |> should.equal(option.None)
}
