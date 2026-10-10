//// 襖の開閉の状態（issue-29b / ADR 0033・0042）。サーバーの1か所（ゲームの状態）が持つ。
////
//// - 準備移動の開始では全部開いている。探索の開始で全部閉じる。答え合わせの開始で全部開く
//// - 開ける報告は、準備移動・ペイント・探索の間に、ステージにいる人が、襖の境から 1.5 m
////   以内にいるときだけ受け付ける。開けた襖は開けっぱなし
//// - 移動は閉じた襖で止まる。鬼 CPU が開けた襖も、同じ状態に入る

import gleam/dict
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Exploration, Painting, Position, Preparation, Stage,
}
import rondo_server/games/veryare/grid.{type Edge}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage.{type Cell, Cell}

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

fn selection() -> Game(String) {
  game.new(
    ["a", "b", "c"],
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
  )
}

/// a が鬼の準備移動（隠れ側は別々の場所）。
fn preparation() -> Game(String) {
  selection()
  |> game.move("a", 0.0, 0.0)
  |> expire
  |> spread.hiders(["b", "c"])
}

fn exploration() -> Game(String) {
  preparation() |> expire |> expire
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

/// 部屋の襖を1つ選ぶ。廊下側のマス・部屋側のマスと、それぞれの中心。
fn a_door(g: Game(String)) -> #(Edge, Cell, Cell) {
  let assert [edge, ..] = grid.fusuma(g.grid) |> set.to_list
  let #(corridor, room) = case dict.get(g.grid.regions, edge.a) {
    Ok("open") -> #(edge.a, edge.b)
    _ -> #(edge.b, edge.a)
  }
  #(edge, corridor, room)
}

fn center(c: Cell) -> #(Float, Float) {
  #(int.to_float(c.x) +. 0.5, int.to_float(c.z) +. 0.5)
}

// --- フェーズと襖 -----------------------------------------------------------------

/// 準備移動の開始では全部開いている。探索の開始で全部閉じる。答え合わせの開始で全部開く。
pub fn doors_follow_the_phases_test() {
  let prep = preparation()
  prep.phase |> should.equal(Preparation)
  prep.open_doors |> should.equal(grid.fusuma(prep.grid))
  let painting = expire(prep)
  painting.phase |> should.equal(Painting)
  painting.open_doors |> should.equal(grid.fusuma(prep.grid))
  let exploring = expire(painting)
  exploring.phase |> should.equal(Exploration)
  exploring.open_doors |> should.equal(set.new())
  let reveal = expire(exploring)
  reveal.open_doors |> should.equal(grid.fusuma(prep.grid))
}

// --- 開ける報告 --------------------------------------------------------------------

/// 探索中、襖の境から 1.5 m 以内の鬼が開けると、開いて、開けっぱなしになる。
pub fn oni_opens_a_nearby_door_test() {
  let g = exploration()
  let #(edge, corridor, _room) = a_door(g)
  let opened =
    g
    |> place("a", center(corridor).0, center(corridor).1)
    |> game.open_door("a", edge)
  opened.open_doors |> should.equal(set.from_list([edge]))
  // 開けっぱなし（次の報告やほかの操作で閉じない）。
  opened
  |> game.open_door("a", edge)
  |> fn(again) { again.open_doors }
  |> should.equal(set.from_list([edge]))
}

/// 1.5 m ちょうどまでは開けられ、それより遠いと開かない。
pub fn doors_open_only_within_reach_test() {
  game.door_reach |> should.equal(1.5)
  let g = exploration()
  let #(edge, _corridor, _room) = a_door(g)
  // 境の線分の中点から、境に垂直な向きへ離れた点を作る。
  let #(mx, mz) = edge_midpoint(edge)
  let away = fn(d: Float) {
    case edge.a.x == edge.b.x {
      // 上下に並ぶマスの境（z が一定の線）。z の向きに離れる。
      True -> #(mx, mz +. d)
      False -> #(mx +. d, mz)
    }
  }
  let #(x, z) = away(1.5)
  g
  |> place("a", x, z)
  |> game.open_door("a", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.from_list([edge]))
  let #(x, z) = away(1.51)
  g
  |> place("a", x, z)
  |> game.open_door("a", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.new())
}

fn edge_midpoint(edge: Edge) -> #(Float, Float) {
  case edge.a.x == edge.b.x {
    True -> #(int.to_float(edge.a.x) +. 0.5, int.to_float(edge.b.z))
    False -> #(int.to_float(edge.b.x), int.to_float(edge.a.z) +. 0.5)
  }
}

/// 襖でない境（壁など）は、開ける報告をしても何も起きない。
pub fn only_fusuma_can_be_opened_test() {
  let g = exploration()
  let #(_edge, corridor, _room) = a_door(g)
  // 廊下のマスの隣で、襖でない境を1つ選ぶ。
  let assert Ok(wall) =
    [#(1, 0), #(-1, 0), #(0, 1), #(0, -1)]
    |> list.map(fn(d) {
      grid.edge(corridor, Cell(corridor.x + d.0, corridor.z + d.1))
    })
    |> list.find(fn(e) { !set.contains(grid.fusuma(g.grid), e) })
  g
  |> place("a", center(corridor).0, center(corridor).1)
  |> game.open_door("a", wall)
  |> fn(o) { o.open_doors }
  |> should.equal(set.new())
}

/// ステージにいない人（準備移動中の待機ルームの鬼）は、開けられない。
pub fn players_off_stage_cannot_open_test() {
  // 準備移動の間、鬼はまだ待機ルームにいる。（確かめやすいよう、襖を閉じた状態から始める）
  let prep = game.Game(..preparation(), open_doors: set.new())
  let #(edge, _, _) = a_door(prep)
  let assert Ok(oni) = dict.get(prep.positions, "a")
  oni.space |> should.equal(game.WaitingRoom)
  prep
  |> game.open_door("a", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.new())
}

/// 鬼選出の間・答え合わせ・終了の後は、開ける報告を受け付けない。
pub fn opening_outside_the_hiding_and_exploring_phases_is_ignored_test() {
  let g = exploration()
  let #(edge, corridor, _) = a_door(g)
  let near = place(g, "a", center(corridor).0, center(corridor).1)
  let reveal = game.Game(..expire(near), open_doors: set.new())
  reveal
  |> game.open_door("a", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.new())
  let selecting = game.Game(..selection(), open_doors: set.new())
  selecting
  |> game.open_door("a", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.new())
}

/// 準備移動・ペイントの間も、ステージにいる人は開けられる（全部開いているので、変わらない）。
pub fn hiders_may_report_during_preparation_and_painting_test() {
  let prep = preparation()
  let #(edge, corridor, _) = a_door(prep)
  let closed =
    game.Game(..prep, open_doors: set.new())
    |> place("b", center(corridor).0, center(corridor).1)
  closed
  |> game.open_door("b", edge)
  |> fn(o) { o.open_doors }
  |> should.equal(set.from_list([edge]))
}

// --- 移動 ----------------------------------------------------------------------

/// 探索中、閉じた襖で鬼の移動が止まり、開けた後は通れる。
pub fn closed_doors_stop_movement_until_opened_test() {
  let g = exploration()
  let #(edge, corridor, room) = a_door(g)
  let at_door = place(g, "a", center(corridor).0, center(corridor).1)
  let #(rx, rz) = center(room)
  let blocked = at_door |> game.move("a", rx, rz)
  let assert Ok(p) = dict.get(blocked.positions, "a")
  grid.cell_at(g.grid, #(p.x, p.z)) |> should.equal(corridor)
  let opened = at_door |> game.open_door("a", edge) |> game.move("a", rx, rz)
  let assert Ok(q) = dict.get(opened.positions, "a")
  #(q.x, q.z) |> should.equal(#(rx, rz))
}

// --- 鬼 CPU ----------------------------------------------------------------------

/// 鬼 CPU が開けた襖は、ゲームの襖の状態に入る（鬼 CPU だけの状態を持たない）。
pub fn oni_cpu_doors_join_the_game_state_test() {
  let g =
    game.new_with(
      ["h", "cpu-1"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
      game.Cpus(hiders: [], oni: Some("cpu-1"), strength: oni_cpu.Strong),
    )
    |> game.move("h", 0.0, 0.0)
    |> expire
    |> spread.hiders(["h"])
    |> expire
    |> expire
  g.phase |> should.equal(Exploration)
  let ticked = tick_until_a_door_opens(g, 200)
  { set.size(ticked.open_doors) > 0 } |> should.be_true
  let assert Some(walker) = ticked.oni_cpu
  walker.open_doors
  |> set.to_list
  |> list.map(fn(door) { grid.edge(door.corridor, door.slot) })
  |> set.from_list
  |> should.equal(ticked.open_doors)
}

fn tick_until_a_door_opens(g: Game(String), tries: Int) -> Game(String) {
  case set.size(g.open_doors) > 0 || tries == 0 || g.phase != Exploration {
    True -> g
    False -> tick_until_a_door_opens(game.tick(g), tries - 1)
  }
}
