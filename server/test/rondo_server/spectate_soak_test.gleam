//// 観戦ルームの長めの確認（issue-67 段階 ⑤ / rondo_server/spectate_soak）の判定。1 分ごとの行から、
//// プロセスの数・ルームのメモリ（ごみ集めのあと）・観戦者への通知の間隔が、増え続けたり、乱れたり
//// していないかを決める純粋な関数。

import gleeunit/should
import rondo_server/spectate_soak.{SoakRow}

fn row(minute: Int, processes: Int, room_kb: Int, p50: Int, min_gap: Int) {
  SoakRow(
    minute:,
    games: minute * 30,
    processes:,
    room_kb:,
    total_kb: 60_000,
    notices: 5000,
    gap_min_ms: min_gap,
    gap_p50_ms: p50,
    gap_p95_ms: 200,
    gap_max_ms: 400,
  )
}

/// 揺れはあっても、増え続けず、間隔が乱れていなければ、問題なし。
pub fn steady_rows_have_no_problems_test() {
  spectate_soak.problems([
    row(1, 120, 80, 100, 99),
    row(2, 121, 95, 101, 98),
    row(3, 120, 82, 100, 99),
  ])
  |> should.equal([])
}

/// プロセスの数が、最初の分より 10 以上増えたら、問題。
pub fn growing_processes_are_a_problem_test() {
  spectate_soak.problems([row(1, 120, 80, 100, 99), row(30, 140, 80, 100, 99)])
  |> should.equal(["プロセスの数が増えた（120 → 140）"])
}

/// ルームのメモリ（ごみ集めのあと）が、最初の分の 2 倍を超えたら、問題。
pub fn growing_room_memory_is_a_problem_test() {
  spectate_soak.problems([row(1, 120, 80, 100, 99), row(30, 120, 200, 100, 99)])
  |> should.equal(["ルームのメモリが増えた（80 KiB → 200 KiB）"])
}

/// 通知の間隔が、100 ms より明らかに短い（80 ms 未満）分があるか、中央の値が、最初の分から大きくずれたら
/// （1.5 倍 + 20 ms を超えるか、2/3 - 20 ms を下回る）、問題。
pub fn irregular_gaps_are_a_problem_test() {
  spectate_soak.problems([
    row(1, 120, 80, 500, 99),
    row(2, 120, 80, 500, 50),
    row(3, 120, 80, 900, 99),
    row(4, 120, 80, 200, 99),
  ])
  |> should.equal([
    "2 分目: 通知の間隔が短すぎる（最小 50 ms）",
    "3 分目: 通知の間隔の中央の値が、最初の分（500 ms）からずれた（900 ms）",
    "4 分目: 通知の間隔の中央の値が、最初の分（500 ms）からずれた（200 ms）",
  ])
}

/// 行が無ければ、問題（測れていない）。
pub fn no_rows_is_a_problem_test() {
  spectate_soak.problems([]) |> should.equal(["測った行が無い"])
}
