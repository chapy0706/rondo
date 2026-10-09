//// 移動の規則（issue-29a / ADR 0042）。マスの大きさ・原点・各マスの領域・戸の一覧・開いている
//// 襖の集合を入力に取る純粋関数。骨格（1 m）でも平屋（0.3 m）でも同じ規則で動く。

import gleam/dict
import gleam/float
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/grid.{AlwaysClosed, AlwaysOpen, Fusuma, Grid}
import rondo_server/games/veryare/stage.{Cell}

// 小さな屋敷（1マス 1 m、原点 (0, 0)）。
//   x: 01234
//   0  ..A##     . は廊下（open）、A・B は部屋、# は壁
//   1  ..A##     廊下 (1,1) と A (2,1) の境に襖。A と B の境（(2,2)-(2,3)）は壁
//   2  ..A..     廊下 (4,2) は、A の向こうの別の廊下（open。A を通らないと着けない）
//   3  ..B##     廊下 (1,3) と B (2,3) の境に、いつも開いている戸
//   4  ..###     廊下 (1,4) と (2,4) の間には、いつも閉じている戸（(2,4) は壁なので歩けない）
fn tiny(cell_size: Float, origin: #(Float, Float)) -> grid.Grid {
  let open = [
    Cell(0, 0),
    Cell(1, 0),
    Cell(0, 1),
    Cell(1, 1),
    Cell(0, 2),
    Cell(1, 2),
    Cell(0, 3),
    Cell(1, 3),
    Cell(0, 4),
    Cell(1, 4),
    Cell(3, 2),
    Cell(4, 2),
  ]
  let a = [Cell(2, 0), Cell(2, 1), Cell(2, 2)]
  Grid(
    cell_size:,
    origin:,
    width: 5,
    depth: 5,
    regions: dict.from_list(
      list.flatten([
        list.map(open, fn(c) { #(c, "open") }),
        list.map(a, fn(c) { #(c, "A") }),
        [#(Cell(2, 3), "B")],
      ]),
    ),
    doors: dict.from_list([
      #(grid.edge(Cell(1, 1), Cell(2, 1)), Fusuma),
      #(grid.edge(Cell(2, 2), Cell(3, 2)), Fusuma),
      #(grid.edge(Cell(1, 3), Cell(2, 3)), AlwaysOpen),
      #(grid.edge(Cell(1, 4), Cell(2, 4)), AlwaysClosed),
    ]),
  )
}

fn unit() -> grid.Grid {
  tiny(1.0, #(0.0, 0.0))
}

fn all_open(g: grid.Grid) -> set.Set(grid.Edge) {
  grid.fusuma(g)
}

fn none() -> set.Set(grid.Edge) {
  set.new()
}

fn close_to(actual: #(Float, Float), expected: #(Float, Float)) -> Nil {
  let ok =
    float.absolute_value(actual.0 -. expected.0) <. 0.01
    && float.absolute_value(actual.1 -. expected.1) <. 0.01
  case ok {
    True -> Nil
    False -> {
      actual |> should.equal(expected)
      Nil
    }
  }
}

// --- 歩けるマスと境 ---------------------------------------------------------------

/// 領域のあるマスだけが歩ける。
pub fn walkable_cells_have_a_region_test() {
  let g = unit()
  grid.walkable(g, Cell(0, 0)) |> should.be_true
  grid.walkable(g, Cell(2, 1)) |> should.be_true
  grid.walkable(g, Cell(3, 0)) |> should.be_false
  grid.walkable(g, Cell(-1, 0)) |> should.be_false
}

/// 同じ領域どうしは通れ、異なる領域どうしは壁。戸の一覧の境は、種類と開閉で決まる。
pub fn edges_follow_regions_and_doors_test() {
  let g = unit()
  // 同じ領域。
  grid.passable(g, none(), Cell(0, 0), Cell(1, 0)) |> should.be_true
  // 異なる領域（戸なし）は壁。
  grid.passable(g, all_open(g), Cell(1, 0), Cell(2, 0)) |> should.be_false
  grid.passable(g, all_open(g), Cell(2, 2), Cell(2, 3)) |> should.be_false
  // 襖は、開いていれば通れる。
  grid.passable(g, none(), Cell(1, 1), Cell(2, 1)) |> should.be_false
  grid.passable(g, all_open(g), Cell(1, 1), Cell(2, 1)) |> should.be_true
  // いつも開いている戸は、いつも通れる。
  grid.passable(g, none(), Cell(1, 3), Cell(2, 3)) |> should.be_true
  // いつも閉じている戸は、いつも通れない。歩けないマスへも通れない。
  grid.passable(g, all_open(g), Cell(1, 4), Cell(2, 4)) |> should.be_false
  grid.passable(g, all_open(g), Cell(1, 0), Cell(1, -1)) |> should.be_false
  // 境は向きを問わない。
  grid.edge(Cell(2, 1), Cell(1, 1))
  |> should.equal(grid.edge(Cell(1, 1), Cell(2, 1)))
}

// --- 移動 ----------------------------------------------------------------------

/// 同じ領域の中は、そのまま着く。
pub fn movement_inside_a_region_arrives_test() {
  grid.step(unit(), none(), #(0.5, 0.5), #(1.5, 4.5)) |> close_to(#(1.5, 4.5))
}

/// 壁を越える移動は、越える手前で止まる。
pub fn walls_stop_movement_before_the_edge_test() {
  let #(x, z) = grid.step(unit(), all_open(unit()), #(1.5, 0.5), #(2.8, 0.5))
  { x <. 2.0 && x >. 1.99 } |> should.be_true
  z |> should.equal(0.5)
}

/// 斜めに壁へ当たると、壁に沿って滑る。
pub fn movement_slides_along_walls_test() {
  // (1.5, 0.5) から右下へ。x は壁で止まり、z はそのまま進む。
  let #(x, z) = grid.step(unit(), none(), #(1.5, 0.5), #(2.5, 2.5))
  { x <. 2.0 && x >. 1.99 } |> should.be_true
  { float.absolute_value(z -. 2.5) <. 0.01 } |> should.be_true
}

/// 開いた襖は通れ、閉じた襖では止まる。いつも開いている戸は通れ、いつも閉じている戸では止まる。
pub fn doors_follow_their_kind_test() {
  let g = unit()
  grid.step(g, all_open(g), #(1.5, 1.5), #(2.5, 1.5)) |> close_to(#(2.5, 1.5))
  let #(x, _) = grid.step(g, none(), #(1.5, 1.5), #(2.5, 1.5))
  { x <. 2.0 } |> should.be_true
  grid.step(g, none(), #(1.5, 3.5), #(2.5, 3.5)) |> close_to(#(2.5, 3.5))
  let #(x, _) = grid.step(g, all_open(g), #(1.5, 4.5), #(2.5, 4.5))
  { x <. 2.0 } |> should.be_true
}

/// 開いた襖を2つ続けて通り、部屋 A を抜けて向こうの廊下へ着ける。
pub fn movement_passes_several_open_doors_test() {
  let g = unit()
  grid.step(g, all_open(g), #(1.5, 1.5), #(2.5, 1.5))
  |> fn(p) { grid.step(g, all_open(g), p, #(2.5, 2.5)) }
  |> fn(p) { grid.step(g, all_open(g), p, #(4.5, 2.5)) }
  |> close_to(#(4.5, 2.5))
}

/// マスの角をちょうど通るときは、両脇がどちらも通れるときだけ通す。
pub fn corners_pass_only_when_both_sides_are_open_test() {
  let g = unit()
  // (0,0) から (1,1) へ、角 (1,1) をちょうど通る。両脇（(1,0)・(0,1)）とも廊下なので通る。
  grid.step(g, none(), #(0.5, 0.5), #(1.5, 1.5)) |> close_to(#(1.5, 1.5))
  // (1,0) から (2,1) へ、角 (2,1) をちょうど通る。(2,0) への境は壁なので、(2,1) へは入らない。
  let end = grid.step(g, all_open(g), #(1.5, 0.5), #(2.5, 1.5))
  { grid.cell_at(g, end) != Cell(2, 1) } |> should.be_true
}

/// 歩けるマスの外へは出ない（地図の外も同じ）。
pub fn movement_stays_on_walkable_cells_test() {
  let g = unit()
  let end = grid.step(g, all_open(g), #(0.5, 0.5), #(-3.0, 0.5))
  grid.walkable(g, grid.cell_at(g, end)) |> should.be_true
  { end.0 >=. 0.0 } |> should.be_true
  let end = grid.step(g, all_open(g), #(0.5, 4.5), #(0.5, 9.0))
  grid.walkable(g, grid.cell_at(g, end)) |> should.be_true
}

/// マスの大きさ・原点が違っても（0.3 m、原点がずれている）、同じ規則で動く。
pub fn rules_scale_with_cell_size_and_origin_test() {
  let size = 0.3
  let origin = #(-6.225, -0.275)
  let g = tiny(size, origin)
  let at = fn(x: Float, z: Float) {
    #(origin.0 +. x *. size, origin.1 +. z *. size)
  }
  grid.cell_at(g, at(2.5, 1.5)) |> should.equal(Cell(2, 1))
  // 壁で止まる。
  let #(x, _) = grid.step(g, all_open(g), at(1.5, 0.5), at(2.8, 0.5))
  { x <. origin.0 +. 2.0 *. size } |> should.be_true
  // 開いた襖は通れる。
  grid.step(g, all_open(g), at(1.5, 1.5), at(2.5, 1.5))
  |> close_to(at(2.5, 1.5))
}

// --- 骨格を入力に写す ---------------------------------------------------------------

/// 骨格（10種）を写すと、歩けるマス・領域・襖が、骨格と部屋の割り当てに一致する。
pub fn skeleton_layouts_map_to_the_grid_test() {
  list.each(stage.skeletons(), fn(skeleton_of_ten) {
    let layout = stage.generate_on(skeleton_of_ten, 7)
    let skeleton = layout.skeleton
    let g = grid.of_layout(layout)
    g.cell_size |> should.equal(1.0)
    g.origin |> should.equal(#(0.0, 0.0))
    g.width |> should.equal(skeleton.width)
    g.depth |> should.equal(skeleton.depth)
    // 廊下・縁側・玄関は、ひと続きの open。
    list.each(skeleton.walkable, fn(cell) {
      dict.get(g.regions, cell) |> should.equal(Ok("open"))
    })
    let assigned =
      list.filter(skeleton.slots, fn(slot) {
        dict.has_key(layout.rooms, slot.id)
      })
    // 割り当てられたスロットのマスは、そのスロットの領域。空きのスロットは歩けない。
    list.each(skeleton.slots, fn(slot) {
      list.each(slot.cells, fn(cell) {
        case dict.has_key(layout.rooms, slot.id) {
          True -> dict.get(g.regions, cell) |> should.equal(Ok(slot.id))
          False -> grid.walkable(g, cell) |> should.be_false
        }
      })
    })
    // 歩けるマスは、それだけ。
    let expected =
      list.length(skeleton.walkable)
      + list.fold(assigned, 0, fn(n, slot) { n + list.length(slot.cells) })
    dict.size(g.regions) |> should.equal(expected)
    // 戸は、割り当てられたスロットの襖だけ。
    let doors =
      assigned
      |> list.flat_map(fn(slot) { slot.doors })
      |> list.map(fn(door) { #(grid.edge(door.corridor, door.slot), Fusuma) })
      |> dict.from_list
    g.doors |> should.equal(doors)
    // 玄関（spawn）は歩ける。
    grid.walkable(g, grid.cell_at(g, skeleton.spawn)) |> should.be_true
  })
}
