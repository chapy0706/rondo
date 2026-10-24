//// 増え鬼（ADR 0053 の最小版）の状態機械と結果。
////
//// - 見つかった人間の隠れ側は、見つかった場所で鬼になる（すぐ動け、撃てる。撃つ間隔は鬼ごと）
//// - 隠れ CPU は鬼にならない。隠れ側が 0 人で鬼の勝ち。時間切れで 1 人以上残れば隠れ側の勝ち
//// - 同時に複数の鬼が同じ隠れ側を撃っても、最初の 1 つだけが有効（二重に鬼にならない）
//// - 途中から鬼になった人の離脱は、鬼から外すだけ。結果では鬼の側に並ぶ
//// - 従来の規則では、見つかった人は鬼にならない（これまでどおり）

import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, HidersWin, OniWins, Position, Reveal, Stage,
}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/result
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

/// a が鬼、b・c・d が隠れ側の探索。spreading なら増え鬼。
fn exploration(spreading: Bool) -> Game(String) {
  let g =
    game.new(
      ["a", "b", "c", "d"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
  let g = case spreading {
    True -> game.with_spreading(g)
    False -> g
  }
  let g =
    g
    |> game.move("a", 0.0, 0.0)
    |> expire
    |> spread.hiders(["b", "c", "d"])
    |> expire
    |> expire
  let g = game.Game(..g, shot_sight: False)
  g.phase |> should.equal(Exploration)
  g
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

fn position(g: Game(String), id: String) -> #(Float, Float) {
  let assert Ok(Position(_, x, z)) = game.position_of_player(g, id)
  #(x, z)
}

/// 見つかった人間の隠れ側は、鬼になる（見つかった場所のまま）。従来の規則では、ならない。
pub fn found_humans_become_oni_test() {
  let g = exploration(True)
  let at = position(g, "b")
  let after = game.found(g, "b")
  after.extra_oni |> should.equal(["b"])
  game.is_oni(after, "b") |> should.be_true
  set.contains(after.still_hiding, "b") |> should.be_false
  position(after, "b") |> should.equal(at)
  after.phase |> should.equal(Exploration)

  let classic = game.found(exploration(False), "b")
  classic.extra_oni |> should.equal([])
  game.is_oni(classic, "b") |> should.be_false
}

/// 鬼になった人は、すぐ動けて、撃てる。撃つ間隔は鬼ごと（最初の鬼が撃った直後でも撃てる）。
pub fn new_oni_moves_and_shoots_at_once_test() {
  let g = exploration(True) |> game.found("b")
  // 動ける（向きの報告を受け付けるのは、動ける人だけ）。
  dict.get(game.turn(g, "b", 1.0).facings, "b") |> should.equal(Ok(1.0))
  // 最初の鬼が c を外して撃ち（間隔が始まる）、同じ時刻に b が d を撃つ。
  let #(cx, cz) = position(g, "c")
  let shooting =
    g
    |> place("a", cx +. 20.0, cz)
    |> place("b", cx, cz)
  let after =
    shooting
    |> game.shoot("a", Some("c"), 0)
    |> game.shoot("b", Some("c"), 0)
  set.contains(after.still_hiding, "c") |> should.be_false
  after.extra_oni |> should.equal(["b", "c"])
  // b の次の射撃は、b の間隔が明けるまで受け付けない。
  game.shoot(after, "b", Some("d"), 1000) |> should.equal(after)
}

/// 同時に 2 人の鬼が同じ隠れ側を撃っても、最初の 1 つだけが有効（二重に鬼にならない）。
pub fn simultaneous_shots_convert_once_test() {
  let g = exploration(True) |> game.found("b")
  let #(cx, cz) = position(g, "c")
  let after =
    g
    |> place("a", cx, cz)
    |> place("b", cx, cz)
    |> game.shoot("a", Some("c"), 0)
    |> game.shoot("b", Some("c"), 0)
  after.extra_oni |> should.equal(["b", "c"])
  set.size(after.still_hiding) |> should.equal(1)
}

/// 隠れ側が 0 人になったら鬼の勝ち。最後の 1 人も鬼の側に並ぶ。
pub fn last_hider_found_gives_oni_the_win_test() {
  let g =
    exploration(True)
    |> game.found("b")
    |> game.found("c")
    |> game.found("d")
  g.phase |> should.equal(Reveal(OniWins))
  g.extra_oni |> should.equal(["b", "c", "d"])
  let assert Ok(#(_, rows)) = result.of(expire(g))
  rows
  |> list.map(fn(row) { #(row.player, row.rank) })
  |> should.equal([#("a", 1), #("b", 1), #("c", 1), #("d", 1)])
}

/// 時間切れで 1 人以上残れば隠れ側の勝ち。途中から鬼になった人は、鬼の側（負け）に並ぶ。
pub fn time_up_with_survivors_gives_hiders_the_win_test() {
  let g = exploration(True) |> game.found("b") |> expire
  g.phase |> should.equal(Reveal(HidersWin))
  let ended = expire(g)
  ended.phase |> should.equal(Ended(HidersWin))
  let assert Ok(#(_, rows)) = result.of(ended)
  rows
  |> list.map(fn(row) { #(row.player, row.rank) })
  |> should.equal([#("c", 1), #("d", 1), #("a", 2), #("b", 2)])
  let assert Ok(b_row) = list.find(rows, fn(row) { row.player == "b" })
  b_row.details
  |> should.equal([#("役割", "鬼"), #("結果", "負け"), #("状態", "途中から鬼")])
}

/// 隠れ CPU は、見つかっても鬼にならない。
pub fn hider_cpus_do_not_become_oni_test() {
  let g =
    game.new_with(
      ["a", "b", "cpu-1"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
      game.Cpus(hiders: ["cpu-1"], oni: None, strength: oni_cpu.Normal),
    )
    |> game.with_spreading
    |> game.move("a", 0.0, 0.0)
    |> expire
    |> expire
    |> expire
  g.phase |> should.equal(Exploration)
  let after = game.found(g, "cpu-1")
  after.extra_oni |> should.equal([])
  set.contains(after.still_hiding, "cpu-1") |> should.be_false
}

/// 途中から鬼になった人の離脱は、鬼から外すだけ（試合は続く）。最初の鬼の離脱は、従来どおり隠れ側の勝ち。
pub fn leaving_extra_oni_only_leaves_the_oni_side_test() {
  let g = exploration(True) |> game.found("b")
  let left = game.leave(g, "b")
  left.extra_oni |> should.equal([])
  left.phase |> should.equal(Exploration)
  left.still_hiding |> should.equal(g.still_hiding)
  game.leave(g, "a").phase |> should.equal(Reveal(HidersWin))
}

/// 途中から鬼になった人の一覧（位置と向き）は、探索・答え合わせの間だけ。
pub fn extra_onis_are_listed_with_their_positions_test() {
  let g = exploration(True)
  game.extra_onis(g) |> should.equal([])
  let after = game.found(g, "b") |> game.turn("b", 1.0)
  let assert [entry] = game.extra_onis(after)
  entry.player |> should.equal("b")
  entry.facing |> should.equal(Some(1.0))
  game.extra_onis(game.found(exploration(False), "b")) |> should.equal([])
}
