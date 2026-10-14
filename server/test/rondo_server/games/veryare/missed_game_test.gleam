//// 見逃しポイントの累積といいね（issue-32 / ADR 0036）。状態機械（game.gleam）の部分。
//// 0.5 秒ごとのタイマーと通知は missed_room_test で確かめる。

import gleam/dict
import gleam/list
import gleam/option.{None}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, HidersWin, OniWins, Position, Reveal, Stage,
}
import rondo_server/games/veryare/missed
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

/// a が鬼、b・c が隠れ側の探索フェーズ。
fn exploration() -> Game(String) {
  game.new(
    ["a", "b", "c"],
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
  )
  |> game.move("a", 0.0, 0.0)
  |> expire
  |> spread.hiders(["b", "c"])
  |> expire
  |> expire
}

fn place(g: Game(String), id: String, x: Float, z: Float) -> Game(String) {
  game.Game(..g, positions: dict.insert(g.positions, id, Position(Stage, x, z)))
}

/// 鬼 a を (0, 0)、b を (3, 0)（圏内）、c を (0, 7)（圏外）に置く。
fn ready() -> Game(String) {
  exploration()
  |> place("a", 0.0, 0.0)
  |> place("b", 3.0, 0.0)
  |> place("c", 0.0, 7.0)
}

fn points(g: Game(String), id: String) -> Int {
  game.missed_points_of(g, id)
}

/// 答え合わせ（探索の時間切れ）まで進める。
fn reveal(g: Game(String)) -> Game(String) {
  expire(g)
}

// --- 見逃しポイントの累積 ---------------------------------------------------------------

/// 前提: 探索フェーズで、b と c が隠れていて、まだ誰もポイントを持たない。
pub fn setup_test() {
  let g = ready()
  g.phase |> should.equal(Exploration)
  points(g, "b") |> should.equal(0)
  points(g, "c") |> should.equal(0)
}

/// 0.5 秒ごとの加算で、圏内の隠れ側だけに足していく。圏外には足さない。
pub fn award_adds_points_in_range_test() {
  let once = ready() |> game.award_missed
  // b は 3 m（比率 0.65）で圏内だけ: 3 × 0.65 = 1.95 → 2。
  points(once, "b") |> should.equal(2)
  points(once, "c") |> should.equal(0)
  let twice = game.award_missed(once)
  points(twice, "b") |> should.equal(4)
}

/// 鬼の視界の報告に入っている間は、圏内だけより高く足す（15 × 0.65 = 9.75 → 10）。
pub fn sighted_hider_gets_more_test() {
  let g = ready() |> game.report_sight("a", ["b"]) |> game.award_missed
  points(g, "b") |> should.equal(10)
}

/// 視界の報告は、圏外の人には効かない（距離はサーバーが判定する）。
pub fn sight_report_does_not_reach_out_of_range_test() {
  let g = ready() |> game.report_sight("a", ["b", "c"]) |> game.award_missed
  points(g, "c") |> should.equal(0)
}

/// 視界の報告は、次の報告で置き換える（前の報告を足し続けない）。
pub fn sight_report_is_replaced_test() {
  let g =
    ready()
    |> game.report_sight("a", ["b"])
    |> game.report_sight("a", [])
    |> game.award_missed
  points(g, "b") |> should.equal(2)
}

/// 視界の報告は、探索中の鬼だけが送れる。隠れ側・ほかのフェーズの報告は無視する。
pub fn only_oni_reports_sight_during_exploration_test() {
  let g = ready()
  game.report_sight(g, "b", ["c"]) |> should.equal(g)
  let revealed = reveal(g)
  game.report_sight(revealed, "a", ["b"]) |> should.equal(revealed)
}

/// 見つかった時点で加算を止め、それまでのポイントは残す。
pub fn found_hider_stops_but_keeps_points_test() {
  let g = ready() |> game.award_missed |> game.award_missed
  points(g, "b") |> should.equal(4)
  let found = game.found(g, "b") |> game.award_missed
  points(found, "b") |> should.equal(4)
}

/// 探索フェーズのとき以外は、加算しない。
pub fn no_award_outside_exploration_test() {
  let revealed = ready() |> reveal
  revealed.phase |> should.equal(Reveal(HidersWin))
  game.award_missed(revealed) |> should.equal(revealed)
}

/// パラメータは状態機械の値で変えられる（実際に遊んで調整する前提）。
pub fn params_are_adjustable_on_game_test() {
  let g =
    game.Game(
      ..ready(),
      missed_params: missed.Params(
        radius: 2.0,
        in_range: 3,
        in_sight: 15,
        near_ratio: 1.0,
        edge_ratio: 0.3,
      ),
    )
    |> game.award_missed
  // 半径 2 m なら、3 m の b は圏外。
  points(g, "b") |> should.equal(0)
}

/// 鬼が CPU のときは、鬼 CPU の視界（seen）を、視界に入っているとして使う。
pub fn cpu_oni_uses_cpu_sight_test() {
  let g =
    game.new_with(
      ["a", "b", "cpu-1"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
      game.Cpus(hiders: [], oni: option.Some("cpu-1"), strength: oni_cpu.Normal),
    )
    |> game.move("a", 0.0, 0.0)
    |> expire
    |> spread.hiders(["a", "b"])
    |> expire
    |> expire
  g.oni |> should.equal(option.Some("cpu-1"))
  let placed =
    g
    |> place("cpu-1", 0.0, 0.0)
    |> place("a", 3.0, 0.0)
    |> place("b", 0.0, 3.0)
    |> fn(g) { game.Game(..g, seen: ["a"]) }
    |> game.award_missed
  points(placed, "a") |> should.equal(10)
  points(placed, "b") |> should.equal(2)
  // 人間の視界の報告は、鬼 CPU には効かない（鬼でない人の報告として無視する）。
  game.report_sight(g, "a", ["b"]) |> should.equal(g)
}

// --- いいね ----------------------------------------------------------------------

/// 答え合わせの間、隠れていた人へいいねを送れる。数は送った人の数。
pub fn likes_during_reveal_test() {
  let g = ready() |> reveal |> game.like("a", "b") |> game.like("c", "b")
  game.likes_of(g, "b") |> should.equal(2)
  game.likes_of(g, "c") |> should.equal(0)
}

/// 1人が同じ隠れ側に送れるのは1回まで。2回目以降は数えない。
pub fn second_like_from_same_sender_is_ignored_test() {
  let once = ready() |> reveal |> game.like("a", "b")
  game.like(once, "a", "b") |> should.equal(once)
  game.likes_of(once, "b") |> should.equal(1)
}

/// 自分自身には送れない。鬼には送れない（隠れ側でない）。参加者でない人は送れない。
pub fn self_and_non_hider_likes_are_ignored_test() {
  let g = ready() |> reveal
  game.like(g, "b", "b") |> should.equal(g)
  game.like(g, "b", "a") |> should.equal(g)
  game.like(g, "z", "b") |> should.equal(g)
}

/// 答え合わせの前（探索中）と、終了の後は、送れない。
pub fn likes_outside_reveal_are_ignored_test() {
  let g = ready()
  game.like(g, "a", "b") |> should.equal(g)
  let ended = reveal(g) |> expire
  ended.phase |> should.equal(Ended(HidersWin))
  game.like(ended, "a", "b") |> should.equal(ended)
}

/// 見つかった隠れ側にも、隠れていた場所へいいねを送れる（探索の開始の時点で隠れていた人）。
pub fn found_hider_can_receive_likes_test() {
  let g = ready() |> game.found("b") |> reveal |> game.like("a", "b")
  game.likes_of(g, "b") |> should.equal(1)
}

// --- 勝敗に影響しない -----------------------------------------------------------------

/// ポイントといいねを変えても、勝敗（フェーズの遷移・まだ隠れている人）は変わらない。
pub fn points_and_likes_do_not_change_outcome_test() {
  let plain = ready()
  let decorated =
    game.Game(
      ..plain,
      missed_points: dict.from_list([#("b", 999_999), #("c", 0)]),
      sighted: set.from_list(["b", "c"]),
    )
    |> game.award_missed
    |> game.award_missed
  // 時間切れ: どちらも隠れ側の勝ち。
  let a = plain |> reveal
  let b = decorated |> reveal
  a.phase |> should.equal(b.phase)
  a.still_hiding |> should.equal(b.still_hiding)
  // いいねを集めても、終了の勝敗は同じ。
  let liked = b |> game.like("a", "b") |> game.like("c", "b") |> expire
  liked.phase |> should.equal(expire(a).phase)

  // 全員見つけると、ポイントを持っていても鬼の勝ち。
  let all_found = decorated |> game.found("b") |> game.found("c")
  all_found.phase |> should.equal(Reveal(OniWins))
  let plain_found = plain |> game.found("b") |> game.found("c")
  plain_found.phase |> should.equal(all_found.phase)
}

/// 鬼選出が済むまで、ポイントもいいねも持たない。
pub fn starts_empty_test() {
  let g =
    game.new(
      ["a", "b"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
  g.missed_points |> should.equal(dict.new())
  g.likes |> should.equal(dict.new())
  g.sighted |> should.equal(set.new())
  list.length(g.players) |> should.equal(2)
  g.oni |> should.equal(None)
}
