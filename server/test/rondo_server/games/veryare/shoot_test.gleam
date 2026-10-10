//// 射撃の判定（issue-27 / ADR 0022）。判定はサーバーが行い、時刻は呼び出し側が渡す。
////
//// - 探索フェーズのときだけ、鬼だけが撃てる
//// - 前の射撃から間隔（既定 3 秒）が空いていなければ、申告ごと無視する（間隔も始め直さない）
//// - 間隔が空いていれば、当たり外れに関わらず、その時刻から次の間隔が始まる
//// - 命中は、狙った相手がまだ隠れていて、射程（8 m）の内側で、（見通しの判定が有効なら）
////   壁に遮られていないこと。命中したら既存の found（発見）を通る
//// - 見通しの判定は、ステージの座標が統一される issue-29 まで、実際のルームでは無効

import gleam/dict
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, OniWins, Position, Reveal, Stage,
}
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage.{Cell, Door, Layout, Washitsu}

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

/// a が鬼、b・c が隠れ側の探索フェーズ。位置はテストで置き直す。
fn exploration() -> Game(String) {
  game.new(
    ["a", "b", "c"],
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
  )
  |> game.move("a", 0.0, 0.0)
  |> expire
  // 玄関に全員が現れるので、被らないよう隠れ側を別々の場所へ動かす（issue-29a）。
  |> spread.hiders(["b", "c"])
  |> expire
  |> expire
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

/// 鬼 a を (0, 0)、b を (3, 0)、c を (0, 4) に置く（どちらも射程の内側）。
/// この節は、射程・間隔・役割の判定だけを確かめるので、見通しの判定は切る（見通しは、
/// 下の「見通し」の節と、実際のステージでの節で確かめる）。
fn ready() -> Game(String) {
  exploration()
  |> fn(g) { game.Game(..g, shot_sight: False) }
  |> place("a", 0.0, 0.0)
  |> place("b", 3.0, 0.0)
  |> place("c", 0.0, 4.0)
}

fn hiding(g: Game(String)) -> List(String) {
  g.still_hiding |> set.to_list
}

// --- 撃てるとき ------------------------------------------------------------------

/// 前提: 探索フェーズで、b と c が隠れている。
pub fn setup_is_exploration_test() {
  let g = ready()
  g.phase |> should.equal(Exploration)
  hiding(g) |> should.equal(["b", "c"])
}

/// 鬼が、射程の内側のまだ隠れている相手を撃つと、命中して見つかる（found と同じ）。
pub fn oni_hits_hider_in_range_test() {
  let g = ready() |> game.shoot("a", Some("b"), 10_000)
  hiding(g) |> should.equal(["c"])
  g.phase |> should.equal(Exploration)
  // 命中の結果は、found（人間の鬼が当てたときと同じ処理）と同じ。
  let found = game.found(ready(), "b")
  g.still_hiding |> should.equal(found.still_hiding)
}

/// 探索フェーズ以外では、撃っても何も起きない（間隔も始まらない）。
pub fn shooting_outside_exploration_is_ignored_test() {
  let preparation =
    game.new(
      ["a", "b"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
    |> game.move("a", 0.0, 0.0)
    |> expire
  preparation |> game.shoot("a", Some("b"), 0) |> should.equal(preparation)
}

/// 鬼でない人が撃っても、何も起きない。
pub fn only_the_oni_can_shoot_test() {
  let g = ready()
  g |> game.shoot("b", Some("c"), 10_000) |> should.equal(g)
}

/// 射程はちょうど 8 m まで。それより遠い相手には当たらない。
pub fn range_is_eight_meters_test() {
  game.shot_range |> should.equal(8.0)
  ready()
  |> place("b", 8.0, 0.0)
  |> game.shoot("a", Some("b"), 10_000)
  |> hiding
  |> should.equal(["c"])
  ready()
  |> place("b", 8.01, 0.0)
  |> game.shoot("a", Some("b"), 10_000)
  |> hiding
  |> should.equal(["b", "c"])
}

/// まだ隠れていない相手（見つかった人、鬼自身、いない人）には当たらない。
pub fn only_hiding_players_can_be_hit_test() {
  let found = ready() |> game.shoot("a", Some("b"), 10_000)
  found
  |> game.shoot("a", Some("b"), 20_000)
  |> hiding
  |> should.equal(["c"])
  ready()
  |> game.shoot("a", Some("a"), 10_000)
  |> hiding
  |> should.equal(["b", "c"])
  ready()
  |> game.shoot("a", Some("nobody"), 10_000)
  |> hiding
  |> should.equal(["b", "c"])
}

// --- 撃つ間隔 ------------------------------------------------------------------

/// 撃つ間隔の既定は 3 秒。
pub fn reload_is_three_seconds_by_default_test() {
  game.durations(exploration_ms: 40_000).reload_ms |> should.equal(3000)
}

/// 前の射撃から 3 秒未満の申告は無効。3 秒ちょうどからは撃てる。
pub fn shots_within_reload_are_ignored_test() {
  let first = ready() |> game.shoot("a", Some("b"), 10_000)
  first |> game.shoot("a", Some("c"), 12_999) |> should.equal(first)
  first
  |> game.shoot("a", Some("c"), 13_000)
  |> hiding
  |> should.equal([])
}

/// 無効になった申告は、間隔を始め直さない（前の射撃から数える）。
pub fn ignored_shots_do_not_restart_reload_test() {
  ready()
  |> game.shoot("a", None, 10_000)
  |> game.shoot("a", Some("b"), 12_000)
  |> game.shoot("a", Some("b"), 13_000)
  |> hiding
  |> should.equal(["c"])
}

/// 外れ（狙いなし・隠れていない相手・射程の外）でも、間隔は始まる。
pub fn misses_start_the_reload_test() {
  let misses = [
    ready() |> game.shoot("a", None, 10_000),
    ready() |> game.shoot("a", Some("a"), 10_000),
    ready() |> place("b", 9.0, 0.0) |> game.shoot("a", Some("b"), 10_000),
  ]
  misses
  |> list_each(fn(g) {
    g.last_shot |> should.equal(Some(10_000))
    // 間隔の中なので、射程の内側の c にも当たらない。
    g |> game.shoot("a", Some("c"), 11_000) |> hiding |> should.equal(hiding(g))
  })
}

fn list_each(items: List(a), f: fn(a) -> b) -> Nil {
  case items {
    [] -> Nil
    [first, ..rest] -> {
      let _ = f(first)
      list_each(rest, f)
    }
  }
}

// --- 勝敗（既存の遷移を通る） -----------------------------------------------------

/// 撃って全員を見つけると、鬼の勝ちで答え合わせへ進み、その後に終わる。
pub fn shooting_everyone_gives_oni_the_win_test() {
  let g =
    ready()
    |> game.shoot("a", Some("b"), 10_000)
    |> game.shoot("a", Some("c"), 13_000)
  g.phase |> should.equal(Reveal(OniWins))
  expire(g).phase |> should.equal(Ended(OniWins))
}

// --- 見通し（issue-29 で有効にする） ------------------------------------------------

// 小さな屋敷（sight_test と同じ）。
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

/// 射撃の見通しは、壁と閉じた襖が遮り、開いた襖は通す（issue-29b）。
pub fn shot_line_is_blocked_by_walls_and_closed_doors_test() {
  let map = tiny()
  let closed = set.new()
  let open = set.from_list([door_a])
  // 同じ廊下のまっすぐな区間は通る。角を曲がった先は、角越しなので通らない。
  game.shot_line_clear(map, closed, #(3.5, 1.5), #(3.5, 3.5)) |> should.be_true
  game.shot_line_clear(map, closed, #(3.5, 1.5), #(1.5, 3.5)) |> should.be_false
  // 閉じた襖は遮り、開いた襖は通す（廊下 (3,2) から部屋 A の (2,2)）。
  game.shot_line_clear(map, closed, #(3.5, 2.5), #(2.5, 2.5)) |> should.be_false
  game.shot_line_clear(map, open, #(3.5, 2.5), #(2.5, 2.5)) |> should.be_true
  // 壁越し（廊下 (1,3) と部屋 A の (1,2) の間は壁）は、襖が開いていても通らない。
  game.shot_line_clear(map, open, #(1.5, 3.5), #(1.5, 2.5)) |> should.be_false
}

const door_a = Door(Cell(3, 2), Cell(2, 2))

/// 小さな屋敷で、見通しの判定を入れて撃つ（襖の状態はゲームの状態から）。
fn tiny_room(open: List(grid.Edge)) -> Game(String) {
  ready()
  |> fn(g) {
    game.Game(
      ..g,
      sight_map: tiny(),
      shot_sight: True,
      open_doors: set.from_list(open),
    )
  }
}

/// 壁越しの相手には当たらない（外れとして間隔は始まる）。
pub fn walls_block_shots_test() {
  let through_wall =
    tiny_room([grid.edge(Cell(3, 2), Cell(2, 2))])
    |> place("a", 1.5, 3.5)
    |> place("b", 1.5, 2.5)
    |> game.shoot("a", Some("b"), 10_000)
  hiding(through_wall) |> should.equal(["b", "c"])
  through_wall.last_shot |> should.equal(Some(10_000))
}

/// 閉じた襖越しの相手には当たらず、開いた襖越しなら当たる。
pub fn closed_doors_block_shots_and_open_doors_let_through_test() {
  let shoot_into_room = fn(open) {
    tiny_room(open)
    |> place("a", 3.5, 2.5)
    |> place("b", 2.5, 2.5)
    |> game.shoot("a", Some("b"), 10_000)
    |> hiding
  }
  shoot_into_room([]) |> should.equal(["b", "c"])
  shoot_into_room([grid.edge(Cell(3, 2), Cell(2, 2))]) |> should.equal(["c"])
}

/// 同じ領域で見通せる相手には当たる。
pub fn visible_targets_are_hit_test() {
  tiny_room([])
  |> place("a", 3.5, 1.5)
  |> place("b", 3.5, 3.5)
  |> game.shoot("a", Some("b"), 10_000)
  |> hiding
  |> should.equal(["c"])
}

/// 実際のルームでは、見通しの判定が有効（issue-29b）。
pub fn sight_is_on_by_default_test() {
  exploration().shot_sight |> should.be_true
}

/// 実際のステージ（骨格）でも、玄関から一直線に見通せる隠れ側には、見通しを入れたまま当たる。
pub fn shots_hit_visible_hiders_on_the_real_stage_test() {
  let g = exploration()
  g.shot_sight |> should.be_true
  g
  |> game.shoot("a", Some("b"), 10_000)
  |> game.shoot("a", Some("c"), 13_000)
  |> fn(after) { after.phase }
  |> should.equal(Reveal(OniWins))
}
