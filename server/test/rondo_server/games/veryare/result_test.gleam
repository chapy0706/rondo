//// 勝敗を基盤の順位へ写す（issue-42）。勝ちを 1 位、負けを 2 位にし、同じ順位を共有する。
//// 判定そのものは状態機械（game）の終了遷移のまま使い、ここでは写すだけ。

import gleeunit/should
import rondo_server/games/veryare/game.{type Game}
import rondo_server/games/veryare/result
import rondo_server/games/veryare/stage
import rondo_server/protocol/message.{HigherIsBetter}
import rondo_server/room/driver.{Standing}

fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, always(0))
}

/// a が鬼、b・c・d が隠れ側の探索フェーズ。
fn exploration() -> Game(String) {
  game.new(
    ["a", "b", "c", "d"],
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
  )
  |> game.move("a", 0.0, 0.0)
  |> expire
  |> expire
  |> expire
}

fn oni(rank: Int, score: Int, outcome: String) {
  Standing(player: "a", rank:, score:, details: [
    #("役割", "鬼"),
    #("結果", outcome),
  ])
}

fn hider(id: String, rank: Int, score: Int, outcome: String, status: String) {
  Standing(player: id, rank:, score:, details: [
    #("役割", "隠れる側"),
    #("結果", outcome),
    #("状態", status),
  ])
}

/// 終わる前は、結果を出さない。
pub fn no_result_before_the_end_test() {
  result.of(exploration()) |> should.equal(Error(Nil))
  // 答え合わせの間も、まだ出さない（終了で出す）。
  let reveal = exploration() |> expire
  result.of(reveal) |> should.equal(Error(Nil))
}

/// 時間切れで隠れ側の勝ち。見つかった隠れ側もチームとして 1 位で、状態で区別する。
pub fn hiders_win_ranks_the_whole_team_first_test() {
  let ended =
    exploration()
    |> game.found("b")
    |> expire
    |> expire
  let assert Ok(#(order, standings)) = result.of(ended)
  order |> should.equal(HigherIsBetter)
  standings
  |> should.equal([
    hider("b", 1, 1, "勝ち", "発見・失格・離脱"),
    hider("c", 1, 1, "勝ち", "逃げ切り"),
    hider("d", 1, 1, "勝ち", "逃げ切り"),
    oni(2, 0, "負け"),
  ])
}

/// 全員発見で鬼の勝ち。鬼が 1 位、隠れ側全員が 2 位。
pub fn all_found_ranks_oni_first_test() {
  let ended =
    exploration()
    |> game.found("b")
    |> game.found("c")
    |> game.found("d")
    |> expire
  let assert Ok(#(_, standings)) = result.of(ended)
  standings
  |> should.equal([
    oni(1, 1, "勝ち"),
    hider("b", 2, 0, "負け", "発見・失格・離脱"),
    hider("c", 2, 0, "負け", "発見・失格・離脱"),
    hider("d", 2, 0, "負け", "発見・失格・離脱"),
  ])
}

/// 鬼の離脱で隠れ側の勝ち。離脱した鬼も 2 位として結果に残る。
pub fn oni_leaving_still_lists_the_oni_test() {
  let ended = exploration() |> game.leave("a") |> expire
  let assert Ok(#(_, standings)) = result.of(ended)
  standings
  |> should.equal([
    hider("b", 1, 1, "勝ち", "逃げ切り"),
    hider("c", 1, 1, "勝ち", "逃げ切り"),
    hider("d", 1, 1, "勝ち", "逃げ切り"),
    oni(2, 0, "負け"),
  ])
}

/// 不成立は全員 1 位・score 0。役割はまだ決まっていないので付けない。
pub fn not_enough_players_ranks_everyone_first_with_zero_test() {
  let ended =
    game.new(
      ["a", "b"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
    |> game.move("a", 0.0, 0.0)
    |> game.leave("b")
    |> expire
  ended.phase |> should.equal(game.Ended(game.NotEnoughPlayers))
  let assert Ok(#(_, standings)) = result.of(ended)
  standings
  |> should.equal([
    Standing(player: "a", rank: 1, score: 0, details: [#("結果", "不成立")]),
  ])
}
