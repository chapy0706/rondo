//// 骨格の検算（issue-65 / ADR 0048）。既存の 10 種（ふつう）と、広い屋敷の 30 種の、どちらにも当てる。
////
//// 共通の条件（玄関から、すべてのスロットへ歩いて着ける・襖は 1 つで廊下に面し、部屋どうしの襖は無い・
//// スロットの大きさ）は、どの骨格も満たす。数・廊下の長さ・道のり・幅は、種類ごとの設定（limits）で見る。

import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/skeleton_check.{Normal, Range, Wide}
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/wide_skeleton_maps

fn wide_skeletons() -> List(stage.Skeleton) {
  list.index_map(wide_skeleton_maps.maps, fn(rows, index) {
    stage.parse(index + 101, rows)
  })
}

// --- 既存の 10 種で、検算が正しく働く ----------------------------------------------------

/// 既存の 10 種は、共通の条件と、ふつうの設定の、すべてを満たす（検算が、正しい地図を落とさない）。
pub fn normal_skeletons_pass_test() {
  list.each(stage.skeletons(), fn(skeleton) {
    skeleton_check.problems(skeleton, Normal) |> should.equal([])
  })
}

/// ふつうの設定は、既存の 10 種の値（stage.gleam の構成の幅と、実測）のまま。
pub fn normal_limits_keep_the_existing_values_test() {
  let limits = skeleton_check.limits(Normal)
  limits.washitsu |> should.equal(Range(stage.min_washitsu, stage.max_washitsu))
  limits.oshiire |> should.equal(Range(stage.min_oshiire, stage.max_oshiire))
  limits.washitsu |> should.equal(Range(8, 12))
  limits.oshiire |> should.equal(Range(3, 5))
  // 準備移動 20 秒のうち、見回しの 5 秒を残した 15 秒で歩ける距離（4.5 m/秒 × 15 秒）。
  limits.farthest_door_max |> should.equal(67)
  limits.dead_ends |> should.equal(None)
  limits.branches |> should.equal(None)
}

/// 広い屋敷の設定は、issue-65 の決定のとおり。
pub fn wide_limits_follow_the_decision_test() {
  let limits = skeleton_check.limits(Wide)
  limits.large |> should.equal(Range(22, 26))
  limits.small |> should.equal(Range(20, 26))
  limits.total |> should.equal(Range(46, 52))
  limits.washitsu |> should.equal(Range(18, 24))
  limits.oshiire |> should.equal(Range(7, 11))
  // 部屋 2 つ分（12 m）に、曲がり角の幅（2 m）を足した長さ。
  limits.straight_max |> should.equal(12 + 2)
  limits.dead_ends |> should.equal(Some(Range(5, 12)))
  limits.branches |> should.equal(Some(Range(4, 10)))
  limits.farthest_door_max |> should.equal(150)
}

// --- 壊れた地図を落とす ----------------------------------------------------------------

/// 小さな地図。縁側・庭・玄関は 10 種と同じ記号。rows の差し替えで、壊れた形を作る。
fn tiny(rows: List(String)) -> stage.Skeleton {
  stage.parse(900, rows)
}

const good = [
  "~==......", "~==AAAA..", "~==AAAA..", "~==AAAA+.", "~==AAAA..", "~==AAAA..",
  "~==AAAA..", "~==....+.", "~==...aa.", "###@@@###",
]

pub fn tiny_map_passes_the_common_checks_test() {
  skeleton_check.common_problems(tiny(good)) |> should.equal([])
}

pub fn unreachable_slot_is_rejected_test() {
  // 小スロットの襖の廊下が、ほかの廊下とつながっていない。
  let rows = [
    "~==......", "~==AAAA..", "~==AAAA..", "~==AAAA+.", "~==AAAA..", "~==AAAA..",
    "~==AAAA..", "~==######", "~==##+###", "###@aa###",
  ]
  skeleton_check.common_problems(tiny(rows))
  |> list.any(fn(p) { p == "玄関から着けないスロット: a" })
  |> should.be_true
}

pub fn slot_with_two_doors_is_rejected_test() {
  let rows = [
    "~==......", "~==AAAA..", "~==AAAA+.", "~==AAAA+.", "~==AAAA..", "~==AAAA..",
    "~==AAAA..", "~==....+.", "~==...aa.", "###@@@###",
  ]
  skeleton_check.common_problems(tiny(rows))
  |> should.equal(["襖が 1 つでないスロット: A（2 つ）"])
}

pub fn door_shared_by_two_slots_is_rejected_test() {
  // 襖のマスが、2 つのスロットに接する（部屋どうしを、襖でつなぐ形）。
  let rows = [
    "~==......", "~==AAAA..", "~==AAAA..", "~==AAAA..", "~==AAAA..", "~==AAAA..",
    "~==AAAA..", "~==...+aa", "~==......", "###@@@###",
  ]
  let problems = skeleton_check.common_problems(tiny(rows))
  problems
  |> list.any(fn(p) { p == "2 つのスロットに接する襖: (6, 7)" })
  |> should.be_true
}

pub fn wrong_slot_size_is_rejected_test() {
  let rows = [
    "~==......", "~==AAAA..", "~==AAAA..", "~==AAAA+.", "~==AAAA..", "~==AAAA..",
    "~==......", "~==....+.", "~==...aa.", "###@@@###",
  ]
  skeleton_check.common_problems(tiny(rows))
  |> should.equal(["大きさの違うスロット: A（4 x 5）"])
}

pub fn straight_corridor_is_measured_test() {
  // いちばん長いのは、右端の列（x = 8）の 9 マス。縁側（=）と玄関（@）は、廊下の長さに数えない。
  skeleton_check.stats(tiny(good)).straight |> should.equal(9)
}

pub fn farthest_door_is_measured_from_the_entrance_test() {
  // 玄関（行 9）から、A の襖（7, 3）まで 8 マス（a の襖（7, 7）は 4 マス）。
  let stats = skeleton_check.stats(tiny(good))
  stats.farthest_door |> should.equal(8)
}

// --- 準備移動の時間 --------------------------------------------------------------------

/// 最も遠い襖までの道のり ÷ 4.5 m/秒 + 余裕 5 秒を、5 秒単位に切り上げ、30〜50 秒に収める。
pub fn preparation_seconds_test() {
  skeleton_check.preparation_seconds(0) |> should.equal(30)
  // 100 / 4.5 + 5 = 27.2 → 30
  skeleton_check.preparation_seconds(100) |> should.equal(30)
  // 112 / 4.5 + 5 = 29.9 → 30
  skeleton_check.preparation_seconds(112) |> should.equal(30)
  // 124 / 4.5 + 5 = 32.6 → 35
  skeleton_check.preparation_seconds(124) |> should.equal(35)
  // 150 / 4.5 + 5 = 38.3 → 40
  skeleton_check.preparation_seconds(150) |> should.equal(40)
  // 220 / 4.5 + 5 = 53.9 → 55 → 上限 50
  skeleton_check.preparation_seconds(220) |> should.equal(50)
}

// --- 広い屋敷の 30 種 ------------------------------------------------------------------

pub fn there_are_thirty_wide_skeletons_test() {
  list.length(wide_skeleton_maps.maps) |> should.equal(30)
  // 同じ地図は無い。
  set.size(set.from_list(wide_skeleton_maps.maps)) |> should.equal(30)
}

/// 30 種すべてが、共通の条件と、広い屋敷の設定の、すべてを満たす。
pub fn wide_skeletons_pass_test() {
  list.each(wide_skeletons(), fn(skeleton) {
    #(skeleton.id, skeleton_check.problems(skeleton, Wide))
    |> should.equal(#(skeleton.id, []))
  })
}

/// 広い屋敷は、準備移動の時間のうちに、玄関から最も遠い襖まで歩ける（余裕 5 秒を残して）。
pub fn wide_skeletons_are_walkable_in_the_preparation_test() {
  list.each(wide_skeletons(), fn(skeleton) {
    let stats = skeleton_check.stats(skeleton)
    let seconds = skeleton_check.preparation_seconds(stats.farthest_door)
    {
      int.to_float(stats.farthest_door) /. 4.5 +. 5.0 <=. int.to_float(seconds)
    }
    |> should.be_true
  })
}

/// 始まりの案内は、ステージの通知の幅で見分ける。10 種の最大の幅 < 20 m ≤ 広い屋敷の最小の幅。
pub fn width_tells_wide_from_normal_test() {
  let widths = fn(skeletons: List(stage.Skeleton)) {
    list.map(skeletons, fn(s) { s.width })
  }
  let assert Ok(normal_max) = list.reduce(widths(stage.skeletons()), int.max)
  let assert Ok(wide_min) = list.reduce(widths(wide_skeletons()), int.min)
  { normal_max < skeleton_check.wide_min_width } |> should.be_true
  { skeleton_check.wide_min_width <= wide_min } |> should.be_true
  skeleton_check.wide_min_width |> should.equal(20)
}
