//// 待機ルームのメンバーと待機ポーズ（issue-59 / ADR 0044）。状態機械（game.gleam）の純粋な部分。
//// 送る間隔とタイマーは waiting_sync_test で確かめる。

import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/game.{type Game, WaitingMember}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/stage

fn durations() -> game.Durations {
  game.Durations(
    oni_selection_ms: 10_000,
    preparation_ms: 20_000,
    painting_ms: 20_000,
    exploration_ms: 40_000,
    reveal_ms: 20_000,
    reload_ms: 3000,
  )
}

fn start() -> Game(String) {
  game.new(["a", "b"], durations(), stage.generate(1))
}

fn always(n: Int) -> fn(Int) -> Int {
  fn(_size) { n }
}

/// 鬼選出を済ませる（a がエリアに触れて立候補し、カウントの満了で鬼になる）。
fn select(g: Game(String)) -> Game(String) {
  let counting = game.move(g, "a", 0.0, 0.0)
  game.advance(counting, counting.step, always(0))
}

fn member_of(g: Game(String), id: String) -> game.WaitingMember(String) {
  let assert Ok(member) =
    list.find(game.waiting_members(g), fn(m) { m.player == id })
  member
}

// --- メンバーの一覧 -----------------------------------------------------------------

/// 鬼選出の間、待機ルームにいる人間の参加者全員が、参加順に載る。
pub fn members_list_humans_in_join_order_test() {
  start()
  |> game.waiting_members
  |> list.map(fn(m) { m.player })
  |> should.equal(["a", "b"])
}

/// CPU は待機ルームに描かないので、載せない（ADR 0044）。
pub fn members_exclude_cpus_test() {
  game.new_with(
    ["a", "b", "cpu-1", "cpu-2"],
    durations(),
    stage.generate(1),
    game.Cpus(hiders: ["cpu-1", "cpu-2"], oni: None, strength: oni_cpu.Normal),
  )
  |> game.waiting_members
  |> list.map(fn(m) { m.player })
  |> should.equal(["a", "b"])
}

/// 位置はサーバーが円に丸めた後の値を、小数第 2 位に丸めて載せる。向きは 0.05 rad 単位に丸める。
/// 向きを報告していなければ None。
pub fn members_round_position_and_facing_test() {
  let g =
    start()
    |> game.move("a", 1.234, -0.567)
    |> game.turn("a", 1.5612)
    |> game.move("b", 9.0, 0.0)
  member_of(g, "a")
  |> should.equal(WaitingMember("a", 1.23, -0.57, Some(1.55), None))
  // 円の外は円の縁（半径 3.5 m）に丸めた後の値。
  member_of(g, "b")
  |> should.equal(WaitingMember("b", 3.5, 0.0, None, None))
}

/// 向きの細かい揺れ（0.05 rad 未満）は、同じ値に丸まる。
pub fn small_facing_jitter_rounds_to_same_value_test() {
  let before = start() |> game.turn("a", 1.0)
  let after = before |> game.turn("a", 1.012)
  game.waiting_members(after) |> should.equal(game.waiting_members(before))
}

/// 鬼選出が済んだら（ステージに移ったら）、誰も載らない。ステージの位置は載らない。
pub fn members_are_empty_after_oni_selection_test() {
  let g = select(start())
  g.phase |> should.equal(game.Preparation)
  game.waiting_members(g) |> should.equal([])
  game.waiting_members(game.move(g, "b", 1.0, 1.0)) |> should.equal([])
}

// --- 待機ポーズ -------------------------------------------------------------------

/// 鬼選出の間、一覧の識別子なら受け付け、メンバーの一覧に載る。
pub fn waiting_pose_is_accepted_and_listed_test() {
  let g = start() |> game.set_waiting_pose("b", "femaleDance", 1000)
  member_of(g, "b").pose |> should.equal(Some("femaleDance"))
}

/// 一覧に無い識別子（CPU の値・未知の値）は無視する。
pub fn unknown_waiting_pose_is_ignored_test() {
  let g = start()
  game.set_waiting_pose(g, "b", "standing", 1000) |> should.equal(g)
  game.set_waiting_pose(g, "b", "unknown", 1000) |> should.equal(g)
}

/// 同じ人の変更は 0.3 秒あける。間が足りない変更は無視し、0.3 秒たてば受け付ける。
pub fn waiting_pose_changes_are_rate_limited_test() {
  game.waiting_pose_interval_ms |> should.equal(300)
  let first = start() |> game.set_waiting_pose("b", "femaleDance", 1000)
  let early = game.set_waiting_pose(first, "b", "maleSitting1", 1299)
  member_of(early, "b").pose |> should.equal(Some("femaleDance"))
  let later = game.set_waiting_pose(first, "b", "maleSitting1", 1300)
  member_of(later, "b").pose |> should.equal(Some("maleSitting1"))
  // 別の人には、間の制限はかからない。
  let other = game.set_waiting_pose(first, "a", "idle", 1001)
  member_of(other, "a").pose |> should.equal(Some("idle"))
}

/// 鬼選出の後・参加者でない人・CPU の待機ポーズは無視する。
pub fn waiting_pose_outside_selection_or_by_others_is_ignored_test() {
  let selected = select(start())
  game.set_waiting_pose(selected, "b", "idle", 1000) |> should.equal(selected)

  let g = start()
  game.set_waiting_pose(g, "z", "idle", 1000) |> should.equal(g)

  let with_cpu =
    game.new_with(
      ["a", "cpu-1"],
      durations(),
      stage.generate(1),
      game.Cpus(hiders: ["cpu-1"], oni: None, strength: oni_cpu.Normal),
    )
  game.set_waiting_pose(with_cpu, "cpu-1", "idle", 1000)
  |> should.equal(with_cpu)
}

/// 待機ポーズは、鬼選出が済んだら空にし、ゲームの隠れ側のポーズには引き継がない。
pub fn waiting_pose_is_not_carried_into_hider_pose_test() {
  let g =
    start()
    |> game.set_waiting_pose("b", "femaleDance", 1000)
    |> select
  g.waiting_poses |> should.equal(dict.new())
  g.waiting_pose_at |> should.equal(dict.new())
  // 隠れ側のポーズ（探索の開始の一括配信に載せる値）は、待機ポーズと別のまま空。
  g.poses |> should.equal(dict.new())
  dict.get(g.poses, "b") |> should.equal(Error(Nil))
}

/// 鬼選出中に抜けた人の待機ポーズは、一覧から消える。
pub fn leaving_removes_member_test() {
  start()
  |> game.set_waiting_pose("b", "femaleDance", 1000)
  |> game.leave("b")
  |> game.waiting_members
  |> list.map(fn(m) { m.player })
  |> should.equal(["a"])
}
