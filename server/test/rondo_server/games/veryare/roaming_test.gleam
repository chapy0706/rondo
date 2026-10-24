//// 動ける隠れ側の規則（ADR 0053）の状態機械。
////
//// - まだ隠れている人間の隠れ側は、ペイントと探索の間も動け、向きを報告できる。隠れ CPU と、見つかった
////   隠れ側は動かない。従来の規則では、これまでどおり動けない
//// - 見た目（ペイントとポーズ）の更新は、ペイントと探索の間に何度でも受け付ける（同じ人は 1 秒あける）
//// - 探索の間、鬼と隠れ側が襖の境から 0.8 m 以内に入ると、その襖が開き、開けっぱなし。開ける報告は使わない
//// - 動く隠れ側の一覧は、動ける規則の探索の間だけ。射撃と鬼 CPU は、いまの位置を使う

import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Exploration, Painting, Position, Preparation, Stage,
}
import rondo_server/games/veryare/grid.{type Edge}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/paint
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage.{type Cell}

// --- 補助 ---------------------------------------------------------------

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

fn selection(roaming: Bool) -> Game(String) {
  let g =
    game.new(
      ["a", "b", "c"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
  case roaming {
    True -> game.with_roaming(g)
    False -> g
  }
}

/// a が鬼の準備移動（隠れ側 b・c は別々の場所）。
fn preparation(roaming: Bool) -> Game(String) {
  selection(roaming)
  |> game.move("a", 0.0, 0.0)
  |> expire
  |> spread.hiders(["b", "c"])
}

fn painting(roaming: Bool) -> Game(String) {
  preparation(roaming) |> expire
}

fn exploration(roaming: Bool) -> Game(String) {
  painting(roaming) |> expire
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

fn position(g: Game(String), id: String) -> #(Float, Float) {
  let assert Ok(Position(_, x, z)) = game.position_of_player(g, id)
  #(x, z)
}

/// 玄関から一直線に動ける、まだ使っていない位置（spread と同じ選び方の、3 つ目）。
fn free_spot(g: Game(String)) -> #(Float, Float) {
  let assert [_, _, spot, ..] = spread.spots(g.grid, game.spawn(g), 3, 7.0)
  spot
}

fn strokes(color: String) -> List(paint.Stroke) {
  [paint.Stroke(paint.Torso, color, 0.05, [#(0.5, 0.5)])]
}

/// 部屋の襖を1つ選ぶ。廊下側のマスと部屋側のマス。
fn a_door(g: Game(String)) -> #(Edge, Cell, Cell) {
  let assert [edge, ..] = grid.fusuma(g.grid) |> set.to_list
  case dict.get(g.grid.regions, edge.a) {
    Ok("open") -> #(edge, edge.a, edge.b)
    _ -> #(edge, edge.b, edge.a)
  }
}

fn center(c: Cell) -> #(Float, Float) {
  #(int.to_float(c.x) +. 0.5, int.to_float(c.z) +. 0.5)
}

/// どの襖からも 0.8 m より遠い、歩けるマスの中心。
fn far_from_doors(g: Game(String)) -> #(Float, Float) {
  let doors = grid.fusuma(g.grid) |> set.to_list
  let assert Ok(cell) =
    g.grid.regions
    |> dict.keys
    |> list.find(fn(cell) {
      list.all(doors, fn(edge) {
        grid.distance_to_edge(g.grid, edge, center(cell)) >. 1.5
      })
    })
  center(cell)
}

/// いまの位置に「動く」報告（移動の規則を通るが、位置は変わらない）。
fn stay(g: Game(String), id: String) -> Game(String) {
  let #(x, z) = position(g, id)
  game.move(g, id, x, z)
}

// --- 動ける -------------------------------------------------------------

/// 動ける規則では、まだ隠れている人間の隠れ側が、ペイントの間も探索の間も動ける。
pub fn hiders_move_during_painting_and_exploration_test() {
  let g = painting(True)
  g.phase |> should.equal(Painting)
  let #(x, z) = position(g, "b")
  let moved = game.move(g, "b", x, z +. 0.2)
  { position(moved, "b") != #(x, z) } |> should.be_true

  let g = exploration(True)
  g.phase |> should.equal(Exploration)
  let #(x, z) = position(g, "b")
  let moved = game.move(g, "b", x, z +. 0.2)
  { position(moved, "b") != #(x, z) } |> should.be_true
}

/// 従来の規則では、ペイントと探索の間、隠れ側は動けない（これまでどおり）。
pub fn classic_hiders_stay_still_test() {
  let g = exploration(False)
  let #(x, z) = position(g, "b")
  game.move(g, "b", x, z +. 0.2) |> should.equal(g)
  game.turn(g, "b", 1.0) |> should.equal(g)
  let p = painting(False)
  game.move(p, "b", x, z +. 0.2) |> should.equal(p)
}

/// 見つかった隠れ側は、もう動けない。
pub fn found_hiders_stay_still_test() {
  let g = exploration(True) |> game.found("b")
  let #(x, z) = position(g, "b")
  game.move(g, "b", x, z +. 0.2) |> should.equal(g)
}

/// 隠れ CPU は、動ける規則でも動かない。
pub fn hider_cpus_stay_still_test() {
  let g =
    game.new_with(
      ["a", "b", "cpu-1"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
      game.Cpus(hiders: ["cpu-1"], oni: None, strength: oni_cpu.Normal),
    )
    |> game.with_roaming
    |> game.move("a", 0.0, 0.0)
    |> expire
    |> expire
    |> expire
  g.phase |> should.equal(Exploration)
  let #(x, z) = position(g, "cpu-1")
  game.move(g, "cpu-1", x +. 0.2, z) |> should.equal(g)
  game.look(g, "cpu-1", Some(strokes("#112233")), None, 0) |> should.equal(g)
}

/// 動ける隠れ側の向きを受け付ける（動く隠れ側の通知に載る）。
pub fn roaming_hiders_report_facing_test() {
  let g = exploration(True) |> game.turn("b", 1.0)
  dict.get(g.facings, "b") |> should.equal(Ok(1.0))
}

// --- 見た目の更新 ---------------------------------------------------------

/// 動ける規則では、見た目の更新を何度でも受け付ける。同じ人は 1 秒あける。
pub fn looks_update_repeatedly_with_an_interval_test() {
  game.look_interval_ms |> should.equal(1000)
  let g = painting(True)
  let first = game.look(g, "b", Some(strokes("#111111")), Some("idle"), 0)
  game.paint_of(first, "b") |> should.equal(Some(strokes("#111111")))
  game.pose_of(first, "b") |> should.equal(Some("idle"))
  // 1 秒たたない更新は捨てる。
  game.look(first, "b", Some(strokes("#222222")), None, 999)
  |> should.equal(first)
  // 1 秒たてば受け付ける。None の項目は前のまま。
  let second = game.look(first, "b", Some(strokes("#222222")), None, 1000)
  game.paint_of(second, "b") |> should.equal(Some(strokes("#222222")))
  game.pose_of(second, "b") |> should.equal(Some("idle"))
  // 探索に入っても受け付ける。
  let explored = expire(second)
  explored.phase |> should.equal(Exploration)
  let third = game.look(explored, "b", None, Some("maleCrouch"), 2000)
  game.pose_of(third, "b") |> should.equal(Some("maleCrouch"))
  // 人ごとに間を数える。
  let other = game.look(third, "c", Some(strokes("#333333")), None, 2000)
  game.paint_of(other, "c") |> should.equal(Some(strokes("#333333")))
}

/// 見た目の更新は、鬼・見つかった人・準備移動の間には受け付けない。両方 None も捨てる。
pub fn looks_are_limited_to_roaming_hiders_test() {
  let g = exploration(True)
  game.look(g, "a", Some(strokes("#111111")), None, 0) |> should.equal(g)
  game.look(g, "b", None, None, 0) |> should.equal(g)
  let found = game.found(g, "b")
  game.look(found, "b", Some(strokes("#111111")), None, 0)
  |> should.equal(found)
  let prep = preparation(True)
  prep.phase |> should.equal(Preparation)
  game.look(prep, "b", Some(strokes("#111111")), None, 0) |> should.equal(prep)
}

/// 従来の規則の look は、確定（最初の 1 回だけ / issue-25）と同じ。
pub fn classic_look_is_the_one_time_confirm_test() {
  let g = painting(False)
  let looked = game.look(g, "b", Some(strokes("#111111")), Some("idle"), 0)
  looked
  |> should.equal(game.confirm(g, "b", Some(strokes("#111111")), Some("idle")))
  game.look(looked, "b", Some(strokes("#222222")), None, 5000)
  |> should.equal(looked)
}

// --- 動く隠れ側の一覧 ------------------------------------------------------

/// 動く隠れ側の一覧は、動ける規則の探索の間だけ。まだ隠れている人間を、丸めて載せる。
pub fn roaming_hiders_are_listed_only_while_exploring_test() {
  game.roaming_hiders(painting(True)) |> should.equal([])
  game.roaming_hiders(exploration(False)) |> should.equal([])
  let g = exploration(True)
  let #(x, z) = position(g, "b")
  let moved =
    g
    |> place("b", x +. 0.123, z)
    |> game.turn("b", 1.01)
  let assert [first, second] = game.roaming_hiders(moved)
  first.player |> should.equal("b")
  first.x
  |> should.equal(int.to_float(float.round({ x +. 0.123 } *. 100.0)) /. 100.0)
  first.facing |> should.equal(Some(1.0))
  second.player |> should.equal("c")
  second.facing |> should.equal(None)
  // 見つかった人は載らない。
  game.roaming_hiders(game.found(moved, "b"))
  |> list.map(fn(h) { h.player })
  |> should.equal(["c"])
}

// --- 襖の自動開閉 ----------------------------------------------------------

/// 探索の間、隠れ側が襖の境から 0.8 m 以内に入ると、その襖が開く。離れても閉じない。
pub fn doors_open_when_a_hider_comes_near_test() {
  game.auto_door_reach |> should.equal(0.8)
  let g = exploration(True)
  g.open_doors |> should.equal(set.new())
  let #(edge, corridor, _room) = a_door(g)
  let #(cx, cz) = center(corridor)
  let near = g |> place("b", cx, cz) |> stay("b")
  set.contains(near.open_doors, edge) |> should.be_true
  near.open_doors |> should.equal(grid.door_group(g.grid, edge))
  let #(fx, fz) = far_from_doors(g)
  let away = near |> place("b", fx, fz) |> stay("b")
  away.open_doors |> should.equal(near.open_doors)
}

/// 鬼が近づいても開く。
pub fn doors_open_when_the_oni_comes_near_test() {
  let g = exploration(True)
  let #(edge, corridor, _room) = a_door(g)
  let #(cx, cz) = center(corridor)
  let near = g |> place("a", cx, cz) |> stay("a")
  set.contains(near.open_doors, edge) |> should.be_true
}

/// 襖から遠いところで動いても、開かない。
pub fn far_moves_open_nothing_test() {
  let g = exploration(True)
  let #(fx, fz) = far_from_doors(g)
  let moved = g |> place("b", fx, fz) |> stay("b")
  moved.open_doors |> should.equal(set.new())
}

/// 従来の規則では、近づいても開かない（開ける報告で開ける）。
pub fn classic_doors_do_not_open_by_themselves_test() {
  let g = exploration(False)
  let #(edge, corridor, _room) = a_door(g)
  let #(cx, cz) = center(corridor)
  let near = g |> place("a", cx, cz) |> stay("a")
  near.open_doors |> should.equal(set.new())
  game.open_door(near, "a", edge).open_doors
  |> should.equal(grid.door_group(g.grid, edge))
}

/// 動ける規則では、開ける報告を使わない（捨てる）。
pub fn open_door_reports_are_ignored_when_roaming_test() {
  let g = exploration(True)
  let #(edge, corridor, _room) = a_door(g)
  let #(cx, cz) = center(corridor)
  // 位置を置くだけ（移動の報告を通さない）なので、自動では開いていない。
  let placed = place(g, "a", cx, cz)
  game.open_door(placed, "a", edge) |> should.equal(placed)
}

// --- いまの位置 ------------------------------------------------------------

/// 射撃は、いまの位置で当たり外れを決める（探索の開始の位置ではない）。
pub fn shots_use_the_current_position_test() {
  let g = game.Game(..exploration(True), shot_sight: False)
  let #(ox, oz) = position(g, "a")
  // 射程の外へ逃げた隠れ側には当たらない。
  let escaped = place(g, "b", ox +. game.shot_range +. 1.0, oz)
  let missed = game.shoot(escaped, "a", Some("b"), 0)
  set.contains(missed.still_hiding, "b") |> should.be_true
  // 射程の内へ戻ると当たる。
  let back = place(missed, "b", ox +. 1.0, oz)
  let hit = game.shoot(back, "a", Some("b"), 10_000)
  set.contains(hit.still_hiding, "b") |> should.be_false
}

/// 隠れ側が動けば、移動の報告で、サーバーが持つ位置が変わる（射撃と鬼 CPU は、これを使う）。
pub fn reported_moves_update_the_server_position_test() {
  let g = exploration(True)
  let #(x, z) = free_spot(g)
  let moved = game.move(g, "b", x, z)
  position(moved, "b") |> should.equal(#(x, z))
}

/// 鬼 CPU は、動く隠れ側のいまの位置で探す。鬼 CPU の目の前に立ち続ける隠れ側は見つかり、遠くに
/// とどまる隠れ側は、同じ間には見つからない（探索の開始の位置は、どちらも同じ遠くの場所）。
pub fn oni_cpu_uses_the_current_position_test() {
  let start =
    game.new_with(
      ["cpu-1", "h"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
      game.Cpus(hiders: [], oni: Some("cpu-1"), strength: oni_cpu.Strong),
    )
    |> game.with_roaming
    |> game.move("h", 0.0, 0.0)
    |> expire
  let far = farthest_from(start, game.spawn(start))
  let g = start |> place("h", far.0, far.1) |> expire |> expire
  g.phase |> should.equal(Exploration)
  game.oni_cpu_active(g) |> should.be_true
  // 遠くにとどまる。
  let stayed = repeat(g, 6, game.tick)
  set.contains(stayed.still_hiding, "h") |> should.be_true
  // 毎回、鬼 CPU がこの tick で歩いた先の目の前（向きの先 0.3 m）へ動く（鬼 CPU は、歩いてから見る。
  // 歩き方は隠れ側に左右されないので、同じ状態から先に歩かせて、行き先を知る）。
  let assert game.Skeleton(layout:, sight_map:) = g.ground
  let followed =
    repeat(g, 6, fn(state) {
      let assert Some(walker) = state.oni_cpu
      let walker = oni_cpu.OniCpu(..walker, open_doors: game.sight_doors(state))
      let #(ahead, _, _) = oni_cpu.step(walker, sight_map, layout, [])
      let #(x, z) = ahead.position
      state
      |> place(
        "h",
        x +. 0.3 *. cos(ahead.facing),
        z +. 0.3 *. sin(ahead.facing),
      )
      |> game.tick
    })
  set.contains(followed.still_hiding, "h") |> should.be_false
}

fn repeat(g: a, n: Int, f: fn(a) -> a) -> a {
  case n <= 0 {
    True -> g
    False -> repeat(f(g), n - 1, f)
  }
}

/// from から最も遠い、歩けるマスの中心。
fn farthest_from(g: Game(String), from: #(Float, Float)) -> #(Float, Float) {
  g.grid.regions
  |> dict.keys
  |> list.map(center)
  |> list.fold(from, fn(best, p) {
    case distance(p, from) >. distance(best, from) {
      True -> p
      False -> best
    }
  })
}

fn distance(a: #(Float, Float), b: #(Float, Float)) -> Float {
  let dx = a.0 -. b.0
  let dz = a.1 -. b.1
  dx *. dx +. dz *. dz
}

@external(erlang, "math", "cos")
fn cos(x: Float) -> Float

@external(erlang, "math", "sin")
fn sin(x: Float) -> Float
