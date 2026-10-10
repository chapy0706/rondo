/// 人間のペイントの受け付け（issue-25）。ペイントフェーズの間に、まだ隠れている隠れ側が
/// 送った最初の1回だけを受け付ける。被り判定（準備移動の終わり）には関わらない。
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{type Game}
import rondo_server/games/veryare/paint.{Stroke, Torso}
import rondo_server/games/veryare/stage

fn in_phase(phase: game.Phase) -> Game(String) {
  let base =
    game.new(
      ["a", "b", "c"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
  game.Game(
    ..base,
    phase:,
    oni: Some("a"),
    still_hiding: set.from_list(["b", "c"]),
  )
}

fn strokes(color: String) -> List(paint.Stroke) {
  [Stroke(Torso, color, 0.04, [#(0.5, 0.5)])]
}

/// ペイントフェーズの隠れ側のペイントを受け付ける。
pub fn hider_paint_is_accepted_while_painting_test() {
  let g = game.paint(in_phase(game.Painting), "b", strokes("#a07850"))
  game.paint_of(g, "b") |> should.equal(Some(strokes("#a07850")))
  game.paint_of(g, "c") |> should.equal(None)
}

/// 2回目以降は無視する（最初の1回だけ）。
pub fn only_the_first_paint_is_kept_test() {
  in_phase(game.Painting)
  |> game.paint("b", strokes("#a07850"))
  |> game.paint("b", strokes("#6b5440"))
  |> game.paint_of("b")
  |> should.equal(Some(strokes("#a07850")))
}

/// 鬼・まだ隠れている一覧にいない人のペイントは無視する。
pub fn oni_and_removed_players_cannot_paint_test() {
  let g = in_phase(game.Painting)
  let g = game.Game(..g, still_hiding: set.from_list(["b"]))
  let g =
    g
    |> game.paint("a", strokes("#a07850"))
    |> game.paint("c", strokes("#a07850"))
  game.paint_of(g, "a") |> should.equal(None)
  game.paint_of(g, "c") |> should.equal(None)
}

/// ペイントフェーズ以外（準備移動・探索など）のペイントは無視する。
pub fn paint_outside_painting_is_ignored_test() {
  [game.OniSelection, game.Preparation, game.Exploration]
  |> list_each(fn(phase) {
    in_phase(phase)
    |> game.paint("b", strokes("#a07850"))
    |> game.paint_of("b")
    |> should.equal(None)
  })
}

/// ペイントを受け付けても、まだ隠れている一覧・位置・フェーズは変わらない（被り判定に関わらない）。
pub fn paint_changes_nothing_but_the_paint_test() {
  let before = in_phase(game.Painting)
  let after = game.paint(before, "b", strokes("#a07850"))
  after.still_hiding |> should.equal(before.still_hiding)
  after.positions |> should.equal(before.positions)
  after.phase |> should.equal(before.phase)
  after.step |> should.equal(before.step)
}

fn list_each(items: List(a), f: fn(a) -> Nil) -> Nil {
  case items {
    [] -> Nil
    [first, ..rest] -> {
      f(first)
      list_each(rest, f)
    }
  }
}
