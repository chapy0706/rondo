import gleam/dynamic.{type Dynamic}
import gleeunit/should
import rondo_server/games/tilt_maze/authority as tilt_maze
import rondo_server/room/authority.{Outcome, Ranking}
import rondo_server/room/room_actor.{PlayerId}

fn goal(level: Int) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("goal")),
    #(dynamic.string("level"), dynamic.int(level)),
  ])
}

/// 完走は受信順に順位づけされる（ADR 0014）。
pub fn ranks_by_receive_order_test() {
  let race =
    tilt_maze.new_race([PlayerId("a"), PlayerId("b"), PlayerId("c")])
    |> tilt_maze.record_goal(PlayerId("c"), 10)
    |> tilt_maze.record_goal(PlayerId("a"), 10)

  tilt_maze.is_over(race) |> should.be_false

  let race = tilt_maze.record_goal(race, PlayerId("b"), 10)
  tilt_maze.is_over(race) |> should.be_true

  tilt_maze.to_outcome(race)
  |> should.equal(
    Outcome([
      Ranking(PlayerId("c"), 1),
      Ranking(PlayerId("a"), 2),
      Ranking(PlayerId("b"), 3),
    ]),
  )
}

/// 最終面未満のゴールは完走に数えない。
pub fn non_final_goal_ignored_test() {
  let race =
    tilt_maze.new_race([PlayerId("a")])
    |> tilt_maze.record_goal(PlayerId("a"), 3)

  tilt_maze.is_over(race) |> should.be_false
  tilt_maze.to_outcome(race) |> should.equal(Outcome([]))
}

/// 同じプレイヤーの二重完走は無視する。
pub fn duplicate_finish_ignored_test() {
  let race =
    tilt_maze.new_race([PlayerId("a"), PlayerId("b")])
    |> tilt_maze.record_goal(PlayerId("a"), 10)
    |> tilt_maze.record_goal(PlayerId("a"), 10)

  tilt_maze.is_over(race) |> should.be_false
  tilt_maze.to_outcome(race)
  |> should.equal(Outcome([Ranking(PlayerId("a"), 1)]))
}

/// 参加者でないプレイヤーのゴールは無視する。
pub fn non_participant_ignored_test() {
  let race =
    tilt_maze.new_race([PlayerId("a")])
    |> tilt_maze.record_goal(PlayerId("x"), 10)

  tilt_maze.to_outcome(race) |> should.equal(Outcome([]))
}

/// 箱（Authority）は unknown ペイロードを復号してゴールを反映する。
pub fn box_records_goal_from_payload_test() {
  let box =
    tilt_maze.create([PlayerId("a"), PlayerId("b")])
    |> authority.record(PlayerId("b"), goal(10))

  authority.is_over(box) |> should.be_false

  let box = authority.record(box, PlayerId("a"), goal(10))
  authority.is_over(box) |> should.be_true
  authority.outcome(box)
  |> should.equal(
    Outcome([Ranking(PlayerId("b"), 1), Ranking(PlayerId("a"), 2)]),
  )
}

/// goal でないペイロードは無視する（境界での検証 / ADR 0009）。
pub fn box_ignores_non_goal_payload_test() {
  let other =
    dynamic.properties([#(dynamic.string("type"), dynamic.string("move"))])
  let box =
    tilt_maze.create([PlayerId("a")])
    |> authority.record(PlayerId("a"), other)

  authority.is_over(box) |> should.be_false
}
