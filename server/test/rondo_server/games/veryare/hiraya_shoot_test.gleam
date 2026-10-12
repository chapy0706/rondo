//// 平屋の射撃と見通し（issue-45 の見通しの一般化）。見通しは、移動の規則（issue-29a）と同じ
//// 「辺の通れる・通れない」で判定する。閉じた襖・壁は遮り、開いた襖・いつも開いている戸は通す。
//// 射程（8 m）と撃つ間隔は、ランダム間取りと同じ。

import gleam/dict
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{type Game, Position, Stage}
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage

// --- 補助 ---------------------------------------------------------------

/// 平屋のマス（列, 行）の中心（メートル）。
fn c(col: Int, row: Int) -> #(Float, Float) {
  #(
    hiraya.origin.0 +. hiraya.cell_size *. { int.to_float(col) +. 0.5 },
    hiraya.origin.1 +. hiraya.cell_size *. { int.to_float(row) +. 0.5 },
  )
}

fn edges_of(name: String) -> List(grid.Edge) {
  let assert Ok(door) = list.find(hiraya.doors, fn(d) { d.name == name })
  hiraya.edges(door)
}

/// 探索中（襖は全部閉じている）で、鬼 a と隠れ側 b を、指定の位置に置いた状態。
fn placed(oni: #(Float, Float), target: #(Float, Float)) -> Game(String) {
  let g =
    game.new_hiraya(["a", "b", "c"], game.durations(exploration_ms: 40_000))
    |> game.move("a", 0.0, 0.0)
    |> expire
    |> game.move("b", 4.7, 8.0)
    |> game.move("c", 4.1, 2.8)
    |> expire
    |> expire
  let positions =
    g.positions
    |> dict.insert("a", Position(Stage, oni.0, oni.1))
    |> dict.insert("b", Position(Stage, target.0, target.1))
  game.Game(..g, positions:)
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, fn(_size) { 0 })
}

fn hit(g: Game(String)) -> Bool {
  !set.contains(game.shoot(g, "a", Some("b"), 0).still_hiding, "b")
}

fn open(g: Game(String), name: String) -> Game(String) {
  game.Game(
    ..g,
    open_doors: set.union(g.open_doors, set.from_list(edges_of(name))),
  )
}

// --- line_clear（移動の規則の辺で引く見通し） ----------------------------

pub fn line_clear_inside_one_room_test() {
  let g = hiraya.grid()
  grid.line_clear(g, set.new(), c(24, 28), c(30, 28)) |> should.be_true
}

pub fn line_clear_is_blocked_by_a_wall_even_with_every_fusuma_open_test() {
  let g = hiraya.grid()
  // 和室A (15,15) から和室B (15,26)。境（行 20|21）は壁。
  grid.line_clear(g, grid.fusuma(g), c(15, 15), c(15, 26)) |> should.be_false
}

pub fn line_clear_follows_the_fusuma_state_test() {
  let g = hiraya.grid()
  let door = set.from_list(edges_of("和室B-和室C 4枚戸"))
  grid.line_clear(g, set.new(), c(15, 28), c(26, 28)) |> should.be_false
  grid.line_clear(g, door, c(15, 28), c(26, 28)) |> should.be_true
}

pub fn line_clear_passes_always_open_doors_test() {
  let g = hiraya.grid()
  // キッチン (26,4) からダイニング (26,14)。ガラス戸はいつも開いている。
  grid.line_clear(g, set.new(), c(26, 4), c(26, 14)) |> should.be_true
  // 洗面所 (34,10) から東の廊下 (34,16)。片開き戸はいつも開いている。
  grid.line_clear(g, set.new(), c(34, 10), c(34, 16)) |> should.be_true
}

pub fn line_clear_fails_outside_walkable_cells_test() {
  let g = hiraya.grid()
  // 庭（歩けないマス）から、または庭へ。
  grid.line_clear(g, grid.fusuma(g), c(0, 0), c(4, 4)) |> should.be_false
  grid.line_clear(g, grid.fusuma(g), c(24, 28), c(25, 42)) |> should.be_false
}

/// ランダム間取りの骨格でも、見通しの地図（sight）と同じ答えを返す（襖が全部閉じているとき、
/// 全部開いているとき）。骨格の射撃は、これまでどおり sight を使う。
pub fn line_clear_agrees_with_sight_on_every_skeleton_test() {
  list.each(stage.skeletons(), fn(skeleton) {
    let layout = stage.generate_on(skeleton, 7)
    let map = sight.map_of(layout)
    let g = grid.of_layout(layout)
    let cells =
      g.regions
      |> dict.keys
      |> list.filter(fn(cell) { { cell.x + cell.z } % 3 == 0 })
    let center = fn(cell: stage.Cell) {
      #(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5)
    }
    list.each(
      [
        #(set.new(), set.new()),
        #(set.from_list(sight.doors(map)), grid.fusuma(g)),
      ],
      fn(opened) {
        let #(sight_open, grid_open) = opened
        list.each(cells, fn(from) {
          list.each(cells, fn(to) {
            grid.line_clear(g, grid_open, center(from), center(to))
            |> should.equal(sight.line_of_sight(
              map,
              sight_open,
              center(from),
              center(to),
            ))
          })
        })
      },
    )
  })
}

// --- 射撃 ----------------------------------------------------------------

pub fn shot_hits_a_visible_hider_in_the_same_room_test() {
  placed(c(24, 28), c(30, 28)) |> hit |> should.be_true
}

pub fn shot_misses_through_a_wall_test() {
  let g = placed(c(15, 15), c(15, 26))
  g |> hit |> should.be_false
  game.Game(..g, open_doors: grid.fusuma(g.grid)) |> hit |> should.be_false
}

pub fn shot_misses_through_a_closed_fusuma_and_hits_once_it_is_open_test() {
  let g = placed(c(15, 28), c(26, 28))
  g |> hit |> should.be_false
  g |> open("和室B-和室C 4枚戸") |> hit |> should.be_true
}

pub fn shot_hits_through_an_always_open_door_test() {
  placed(c(26, 4), c(26, 14)) |> hit |> should.be_true
}

pub fn shot_misses_beyond_the_range_test() {
  // 縁側の北の端 (1,6) から南の端 (1,40)。同じ領域だが 10.2 m 離れている。
  placed(c(1, 6), c(1, 40)) |> hit |> should.be_false
  // 7.8 m（行 6 → 32）なら当たる。
  placed(c(1, 6), c(1, 32)) |> hit |> should.be_true
}

pub fn a_hit_is_followed_by_the_reload_interval_test() {
  let g = placed(c(24, 28), c(30, 28))
  let missed = game.Game(..g, last_shot: Some(0))
  // 間隔中は、見える相手でも当たらない。
  !set.contains(game.shoot(missed, "a", Some("b"), 10).still_hiding, "b")
  |> should.be_false
}
