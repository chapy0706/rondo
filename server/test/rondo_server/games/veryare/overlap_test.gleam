import gleam/set
import gleeunit/should
import rondo_server/games/veryare/overlap

/// 半径 0.3m の球（ADR 0026）。中心間が 0.6m 未満なら重なる。
pub fn radius_is_thirty_centimetres_test() {
  overlap.radius |> should.equal(0.3)
}

pub fn two_close_players_both_overlap_test() {
  overlap.overlapping([#("a", 0.0, 0.0), #("b", 0.5, 0.0)])
  |> should.equal(set.from_list(["a", "b"]))
}

/// ちょうど接しているだけ（中心間 = 直径）は重なりではない。
pub fn touching_is_not_overlapping_test() {
  overlap.overlapping([#("a", 0.0, 0.0), #("b", 0.6, 0.0)])
  |> should.equal(set.new())
}

pub fn separated_players_do_not_overlap_test() {
  overlap.overlapping([#("a", 0.0, 0.0), #("b", 3.0, 4.0)])
  |> should.equal(set.new())
}

/// ほぼ同じ座標に3人以上いれば、全員が被り判定に含まれる。
pub fn three_or_more_at_nearly_the_same_point_all_overlap_test() {
  overlap.overlapping([
    #("a", 1.0, 1.0),
    #("b", 1.01, 1.0),
    #("c", 1.0, 1.02),
  ])
  |> should.equal(set.from_list(["a", "b", "c"]))

  overlap.overlapping([
    #("a", 2.0, 2.0),
    #("b", 2.0, 2.0),
    #("c", 2.0, 2.0),
    #("d", 2.0, 2.0),
  ])
  |> should.equal(set.from_list(["a", "b", "c", "d"]))
}

/// 連鎖（a-b, b-c は重なり、a-c は離れている）でも、重なった相手を問わず全員含まれる。
pub fn chained_overlaps_include_everyone_involved_test() {
  overlap.overlapping([#("a", 0.0, 0.0), #("b", 0.5, 0.0), #("c", 1.0, 0.0)])
  |> should.equal(set.from_list(["a", "b", "c"]))
}

/// 重なっている組とそうでない人が混ざっていても、重なった人だけを返す。
pub fn only_overlapping_players_are_returned_test() {
  overlap.overlapping([
    #("a", 0.0, 0.0),
    #("b", 0.2, 0.2),
    #("c", 5.0, 5.0),
  ])
  |> should.equal(set.from_list(["a", "b"]))
}

pub fn fewer_than_two_players_never_overlap_test() {
  overlap.overlapping([]) |> should.equal(set.new())
  overlap.overlapping([#("a", 0.0, 0.0)]) |> should.equal(set.new())
}
