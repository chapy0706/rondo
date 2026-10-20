//// 観戦ルームの隠れ CPU の歩き（issue-67 段階 2）。準備移動の始めに、隠れ場所と、玄関からの道を決め、
//// 人と同じ速さ（4.5 m/秒）で歩く。準備移動の時間（から余裕 2 秒を引いた時間）の内に着き、着いた場所は
//// 互いに被らない（ADR 0026）。10 種と広い屋敷 30 種の、すべての骨格で確かめる。

import gleam/float
import gleam/int
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/hider_cpu.{type Walk}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage.{type Layout, type Skeleton}
import rondo_server/games/veryare/stage_timing

/// 観戦ルームの隠れ CPU の最大（issue-67 の決定。issue-66 のあとで上げる）。
const count = 4

const seeds = [1, 7, 42, 1234, 99_991]

/// 準備移動の時間（ミリ秒）。10 種は 20 秒、広い屋敷は骨格から計算する。
fn preparation_ms(skeleton: Skeleton) -> Int {
  stage_timing.preparation_seconds(skeleton) * 1000
}

fn every_layout() -> List(Layout) {
  list.append(stage.skeletons(), stage.wide_skeletons())
  |> list.flat_map(fn(skeleton) {
    list.map(seeds, fn(seed) { stage.generate_on(skeleton, seed) })
  })
}

fn walks_of(layout: Layout, seed: Int) -> List(Walk) {
  hider_cpu.plan_walks(
    layout,
    count,
    seed,
    hider_cpu.reach_ms(preparation_ms(layout.skeleton)),
  )
}

fn distance(a: #(Float, Float), b: #(Float, Float)) -> Float {
  let dx = a.0 -. b.0
  let dz = a.1 -. b.1
  let assert Ok(d) = float.square_root(dx *. dx +. dz *. dz)
  d
}

/// 準備移動の時間から、余裕 2 秒を引いた時間の内に、着かなければならない。
pub fn reach_leaves_two_seconds_of_margin_test() {
  hider_cpu.walk_speed |> should.equal(4.5)
  hider_cpu.reach_ms(20_000) |> should.equal(18_000)
  hider_cpu.reach_ms(1000) |> should.equal(0)
}

/// すべての骨格で、4 体ぶんの隠れ場所と道が決まり、どれも時間内に着く。
pub fn every_skeleton_gets_four_walks_that_arrive_in_time_test() {
  list.each(every_layout(), fn(layout) {
    list.each([3, 11], fn(seed) {
      let walks = walks_of(layout, seed)
      list.length(walks) |> should.equal(count)
      list.each(walks, fn(walk) {
        {
          hider_cpu.arrival_ms(walk)
          <= hider_cpu.reach_ms(preparation_ms(layout.skeleton))
        }
        |> should.be_true
      })
    })
  })
}

/// 着いた場所（隠れ場所）は、互いに被らない（球が重ならない / ADR 0026）。
pub fn arrived_places_do_not_overlap_test() {
  list.each(every_layout(), fn(layout) {
    let walks = walks_of(layout, 5)
    let bodies =
      list.index_map(walks, fn(walk, i) {
        #(i, walk.placement.x, walk.placement.z)
      })
    overlap.overlapping(bodies) |> set.is_empty |> should.be_true
  })
}

/// 道は玄関から始まり、隠れ場所で終わる。隣り合うマスへ、通れる境（同じ領域か、襖）だけを進む。
pub fn walks_start_at_the_spawn_and_follow_passable_cells_test() {
  list.each(every_layout(), fn(layout) {
    let map = sight.map_of(layout)
    list.each(walks_of(layout, 9), fn(walk) {
      let assert [first, ..] = walk.path
      first |> should.equal(layout.skeleton.spawn)
      let assert Ok(last) = list.last(walk.path)
      last |> should.equal(#(walk.placement.x, walk.placement.z))
      // 2 つ目からは、マスの中心を 1 マスずつ進む。
      let cells = list.map(list.drop(walk.path, 1), sight.cell_of)
      list.window_by_2([sight.cell_of(first), ..cells])
      |> list.each(fn(pair) {
        let #(a, b) = pair
        { a == b || oni_cpu.passable(map, a, b) } |> should.be_true
      })
    })
  })
}

/// いまの位置は、歩き始め（0 ミリ秒）で玄関、着いた時刻とそれより後で隠れ場所。途中は道の上を、
/// 人の速さで進む（100 ミリ秒で 0.45 m を超えて動かない）。
pub fn position_follows_the_path_at_walking_speed_test() {
  let layout = stage.generate_on(first_skeleton(), 21)
  list.each(walks_of(layout, 21), fn(walk) {
    hider_cpu.position_at(walk, 0) |> should.equal(layout.skeleton.spawn)
    let goal = #(walk.placement.x, walk.placement.z)
    hider_cpu.position_at(walk, hider_cpu.arrival_ms(walk))
    |> should.equal(goal)
    hider_cpu.position_at(walk, hider_cpu.arrival_ms(walk) + 5000)
    |> should.equal(goal)
    int.range(0, hider_cpu.arrival_ms(walk) / 100, [], fn(acc, i) { [i, ..acc] })
    |> list.each(fn(i) {
      let a = hider_cpu.position_at(walk, i * 100)
      let b = hider_cpu.position_at(walk, i * 100 + 100)
      { distance(a, b) <=. 0.45 +. 0.001 } |> should.be_true
    })
  })
}

/// 同じ種なら、同じ道（再現できる）。
pub fn same_seed_gives_the_same_walks_test() {
  let layout = stage.generate_on(first_skeleton(), 8)
  walks_of(layout, 8) |> should.equal(walks_of(layout, 8))
}

fn first_skeleton() -> Skeleton {
  let assert [skeleton, ..] = stage.skeletons()
  skeleton
}
