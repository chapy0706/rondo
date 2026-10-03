import gleam/dict
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/sight.{View}
import rondo_server/games/veryare/stage.{Cell, Door, Layout, Washitsu}

// 小さな屋敷（skeleton_maps と同じ書き方）。
//   x: 0123456
//   0  #######
//   1  #AA.bb#     A: 大スロット（x1-2, z1-2）、b: 小スロット（x4-5, z1）
//   2  #AA+###     A の襖は (3,2)-(2,2)、b の襖は (3,1)-(4,1)
//   3  #...###     廊下は x3 の縦と、z3 の横
//   4  #######
fn tiny() -> sight.Map {
  let a = [Cell(1, 1), Cell(2, 1), Cell(1, 2), Cell(2, 2)]
  let b = [Cell(4, 1), Cell(5, 1)]
  let skeleton =
    stage.Skeleton(
      id: 0,
      width: 7,
      depth: 5,
      corridor: [Cell(3, 1), Cell(3, 2), Cell(1, 3), Cell(2, 3), Cell(3, 3)],
      walkable: [Cell(3, 1), Cell(3, 2), Cell(1, 3), Cell(2, 3), Cell(3, 3)],
      slots: [
        stage.Slot("A", stage.Large, a, [Door(Cell(3, 2), Cell(2, 2))]),
        stage.Slot("b", stage.Small, b, [Door(Cell(3, 1), Cell(4, 1))]),
      ],
      engawa: [],
      invisible_walls: [],
      entrance: [],
      spawn: #(3.5, 3.5),
    )
  sight.map_of(Layout(
    skeleton,
    dict.from_list([#("A", Washitsu), #("b", Washitsu)]),
  ))
}

fn center(x: Int, z: Int) -> #(Float, Float) {
  #(int_to_float(x) +. 0.5, int_to_float(z) +. 0.5)
}

@external(erlang, "erlang", "float")
fn int_to_float(x: Int) -> Float

const door_a = Door(Cell(3, 2), Cell(2, 2))

const door_b = Door(Cell(3, 1), Cell(4, 1))

// --- 見通し ----------------------------------------------------------------

/// 同じ部屋の中・同じ廊下の中は見通せる。
pub fn same_region_is_visible_test() {
  let map = tiny()
  sight.line_of_sight(map, set.new(), center(1, 1), center(2, 2))
  |> should.be_true
  sight.line_of_sight(map, set.new(), center(3, 1), center(1, 3))
  |> should.be_false
  sight.line_of_sight(map, set.new(), center(3, 1), center(3, 3))
  |> should.be_true
  sight.line_of_sight(map, set.new(), center(1, 3), center(3, 3))
  |> should.be_true
}

/// 壁の向こうは見えない（廊下 (1,3) から部屋 A の (1,2) は、間が壁）。
pub fn wall_blocks_sight_test() {
  sight.line_of_sight(
    tiny(),
    set.from_list([door_a]),
    center(1, 3),
    center(1, 2),
  )
  |> should.be_false
}

/// 閉じた襖は遮り、開いた襖は通す。
pub fn closed_door_blocks_and_open_door_lets_through_test() {
  let map = tiny()
  sight.line_of_sight(map, set.new(), center(3, 2), center(2, 2))
  |> should.be_false
  sight.line_of_sight(map, set.new(), center(3, 2), center(1, 2))
  |> should.be_false
  sight.line_of_sight(map, set.from_list([door_a]), center(3, 2), center(1, 2))
  |> should.be_true
  // 別の部屋の襖を開けても、A は見えない。
  sight.line_of_sight(map, set.from_list([door_b]), center(3, 2), center(1, 2))
  |> should.be_false
}

/// 開いた襖から斜めに覗いても、襖の脇の壁越しには見えない。
pub fn open_door_does_not_let_sight_through_the_wall_beside_it_test() {
  // (3,3) から (1,1) へは、襖 (3,2)-(2,2) の脇の壁 (2,3)-(2,2) を斜めに抜ける線になる。
  sight.line_of_sight(
    tiny(),
    set.from_list([door_a]),
    center(3, 3),
    center(1, 1),
  )
  |> should.be_false
}

/// 部屋どうしは、襖が両方開いていても直接は見えない（間は壁）。
pub fn rooms_are_not_visible_from_each_other_test() {
  sight.line_of_sight(
    tiny(),
    set.from_list([door_a, door_b]),
    center(2, 1),
    center(4, 1),
  )
  |> should.be_false
}

// --- 視界（角度と距離） --------------------------------------------------------

/// 視野角の外（後ろ）と、視距離の外は見えない。
pub fn field_of_view_and_range_limit_sight_test() {
  let map = tiny()
  // (3,3) から上（z が減る向き = -π/2）を向き、(3,1) を見る。
  let up = View(fov: 1.5, range: 5.0)
  sight.can_see(map, set.new(), center(3, 3), -1.5708, up, center(3, 1))
  |> should.be_true
  // 下を向くと、後ろなので見えない。
  sight.can_see(map, set.new(), center(3, 3), 1.5708, up, center(3, 1))
  |> should.be_false
  // 視距離が足りなければ見えない。
  sight.can_see(
    map,
    set.new(),
    center(3, 3),
    -1.5708,
    View(1.5, 1.5),
    center(3, 1),
  )
  |> should.be_false
}
