//// 平屋のルームの進行（issue-44）。移動の規則（issue-29a）と襖の状態（issue-29b）の仕組みのまま、
//// 平屋のデータで動くこと。勝敗とフェーズの遷移は、ランダム間取りと同じ。

import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, type Position, Exploration, OniWins, Position, Preparation, Reveal,
  Stage,
}
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/stage.{Cell}

// --- 補助 ---------------------------------------------------------------

fn new_game() -> Game(String) {
  game.new_hiraya(["a", "b", "c"], game.durations(exploration_ms: 40_000))
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, fn(_size) { 0 })
}

/// a が鬼になり、準備移動に入った状態。
fn preparation() -> Game(String) {
  new_game() |> game.move("a", 0.0, 0.0) |> expire
}

/// 隠れ側を玄関から別々の場所へ動かし（被りで失格しない）、探索に入った状態。
fn exploration() -> Game(String) {
  preparation()
  // b は東の廊下、c は洗面所へ（玄関から一直線、襖を通らない）。
  |> game.move("b", 4.7, 8.0)
  |> game.move("c", 4.1, 2.8)
  |> expire
  |> expire
}

fn at(g: Game(String), id: String) -> Position {
  let assert Ok(p) = dict.get(g.positions, id)
  p
}

fn edges_of(name: String) -> List(grid.Edge) {
  let assert Ok(door) = list.find(hiraya.doors, fn(d) { d.name == name })
  hiraya.edges(door)
}

// --- テスト -------------------------------------------------------------

/// 平屋のルームは、平屋のデータを移動の規則の入力に持つ。
pub fn hiraya_game_uses_the_hiraya_grid_test() {
  let g = new_game()
  g.grid |> should.equal(hiraya.grid())
  game.spawn(g) |> should.equal(#(4.7, 11.3))
}

/// 隠れ側は準備移動の開始で、鬼は探索の開始で、玄関の (4.7, 11.3) に現れる。
pub fn everyone_appears_at_the_entrance_test() {
  let g = preparation()
  g.phase |> should.equal(Preparation)
  g.oni |> should.equal(Some("a"))
  at(g, "b") |> should.equal(Position(Stage, 4.7, 11.3))
  at(g, "c") |> should.equal(Position(Stage, 4.7, 11.3))
  let e = exploration()
  e.phase |> should.equal(Exploration)
  at(e, "a") |> should.equal(Position(Stage, 4.7, 11.3))
}

/// 襖10組は、準備移動の開始で全部開き、探索の開始で全部閉じ、答え合わせの開始で全部開く。
/// いつも開いている戸・いつも閉じている戸は、開いている襖の集合に入らず、通れるかも変わらない。
pub fn fusuma_close_at_exploration_and_open_at_reveal_test() {
  let all = grid.fusuma(hiraya.grid())
  set.size(all) |> should.equal(108)
  preparation().open_doors |> should.equal(all)
  let e = exploration()
  e.open_doors |> should.equal(set.new())
  let r = e |> expire
  r.phase |> should.equal(Reveal(game.HidersWin))
  r.open_doors |> should.equal(all)
  // いつも開いている戸は、襖が全部閉じていても通れる。いつも閉じている戸は、全部開いていても通れない。
  list.each([e, r], fn(g) {
    list.each(edges_of("洗面所-東の廊下 片開き戸"), fn(edge) {
      grid.passable(g.grid, g.open_doors, edge.a, edge.b) |> should.be_true
    })
    list.each(edges_of("玄関 引違い戸（外へ）"), fn(edge) {
      grid.passable(g.grid, g.open_doors, edge.a, edge.b) |> should.be_false
    })
    set.is_subset(g.open_doors, all) |> should.be_true
  })
}

/// 開ける報告は、29b と同じ条件（襖の境から 1.5 m 以内）で受け付け、その襖の組を全部開ける。
pub fn opening_a_fusuma_opens_the_whole_group_test() {
  let e = exploration()
  // 玄関の鬼から、和室C-東の廊下の襖の南の端（境 (32,35)|(33,35)）までは 1.5 m 以内。
  let edge = grid.edge(Cell(32, 35), Cell(33, 35))
  let opened = game.open_door(e, "a", edge)
  opened.open_doors
  |> should.equal(set.from_list(edges_of("和室C-東の廊下 4枚戸")))
  // 遠い襖（和室A-広縁の障子）は、開けられない。
  game.open_door(e, "a", grid.edge(Cell(7, 9), Cell(8, 9)))
  |> fn(g) { g.open_doors }
  |> should.equal(set.new())
}

/// 見通しの一般化（issue-45）までは、平屋では射撃が当たらない。勝敗の判定は変わらない。
pub fn shots_never_hit_on_hiraya_until_issue_45_test() {
  let e = exploration()
  // 鬼を b のすぐ隣（東の廊下）へ。見通しの判定を外しても当たらない。
  let near =
    game.Game(
      ..e,
      positions: dict.insert(e.positions, "a", Position(Stage, 4.7, 8.5)),
      shot_sight: False,
    )
  let shot = game.shoot(near, "a", Some("b"), 0)
  shot.still_hiding |> should.equal(near.still_hiding)
  shot.last_shot |> should.equal(Some(0))
  // 発見（found）は、ほかの経路と同じに働く（勝敗の判定は共通）。
  let all_found = e |> game.found("b") |> game.found("c")
  all_found.phase |> should.equal(Reveal(OniWins))
  game.shoot(near, "a", None, 0).still_hiding |> should.equal(near.still_hiding)
}
