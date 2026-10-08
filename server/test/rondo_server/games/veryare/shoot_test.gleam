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
import rondo_server/games/veryare/sight
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
  |> expire
  |> expire
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

/// 鬼 a を (0, 0)、b を (3, 0)、c を (0, 4) に置く（どちらも射程の内側）。
fn ready() -> Game(String) {
  exploration()
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

/// 射撃の見通しは、襖を開いている扱いで、壁だけが遮る。
pub fn shot_line_is_blocked_only_by_walls_test() {
  let map = tiny()
  // 同じ廊下のまっすぐな区間は通る。角を曲がった先は、角越しなので通らない。
  game.shot_line_clear(map, #(3.5, 1.5), #(3.5, 3.5)) |> should.be_true
  game.shot_line_clear(map, #(3.5, 1.5), #(1.5, 3.5)) |> should.be_false
  // 襖は開いている扱いなので、廊下から部屋の中へ通る。
  game.shot_line_clear(map, #(3.5, 2.5), #(2.5, 2.5)) |> should.be_true
  // 壁越し（廊下 (1,3) と部屋 A の (1,2) の間は壁）は通らない。
  game.shot_line_clear(map, #(1.5, 3.5), #(1.5, 2.5)) |> should.be_false
}

/// 見通しの判定を有効にすると、壁越しには撃てない（外れとして間隔は始まる）。
/// 実際のルームでは issue-29 で有効にする。
pub fn walls_block_shots_when_sight_is_enabled_test() {
  let base =
    ready()
    |> fn(g) { game.Game(..g, sight_map: tiny(), shot_sight: True) }
    |> place("a", 1.5, 3.5)
  // 壁越し（部屋 A の中の b）には当たらない。
  let through_wall =
    base |> place("b", 1.5, 2.5) |> game.shoot("a", Some("b"), 10_000)
  hiding(through_wall) |> should.equal(["b", "c"])
  through_wall.last_shot |> should.equal(Some(10_000))
  // 同じ廊下（見通せる）の b には当たる。
  base
  |> place("b", 3.5, 3.5)
  |> game.shoot("a", Some("b"), 10_000)
  |> hiding
  |> should.equal(["c"])
}

/// 実際のルームでは、見通しの判定は既定で無効（ステージの座標が統一される issue-29 まで）。
pub fn sight_is_off_by_default_test() {
  exploration().shot_sight |> should.be_false
}
