//// 観戦ルームの設定のシミュレーション（issue-67 段階 ⑤）。鬼 CPU 1 体と、歩く隠れ CPU 4 体で、鬼選出を
//// 飛ばして準備移動から始める（観戦ルームと同じ始まり方）。鬼 CPU の強さと探索の時間の組み合わせごとの、
//// 鬼の勝率から、観戦ルームの既定を選ぶ。

import gleam/list
import gleeunit/should
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/simulation.{SpectateChoice}
import rondo_server/games/veryare/stage

/// どの骨格・強さ・探索の時間でも、試合は終了まで進み、異常（ADR 0028 と、歩きの決まり）が出ない。
/// 隠れ CPU は 4 体とも、時間内に、被らずに、隠れ場所へ歩いて着く。
pub fn spectate_matches_finish_without_anomalies_test() {
  simulation.spectate_hider_count |> should.equal(4)
  list.each(stage.skeletons(), fn(skeleton) {
    list.each(simulation.strengths(), fn(strength) {
      list.each([1, 2], fn(seed) {
        let m = simulation.run_spectate(skeleton, strength, seed, 40_000)
        m.finished |> should.be_true
        m.anomalies |> should.equal([])
        { list.length(m.find_seconds) <= 4 } |> should.be_true
      })
    })
  })
}

/// 種を固定すれば、同じ試合になる。
pub fn same_seed_gives_the_same_spectate_match_test() {
  let assert [skeleton, ..] = stage.skeletons()
  simulation.run_spectate(skeleton, oni_cpu.Normal, 7, 60_000)
  |> should.equal(simulation.run_spectate(skeleton, oni_cpu.Normal, 7, 60_000))
}

/// 鬼の勝率が 40〜60% に収まる組み合わせのうち、50% に最も近いものを選ぶ（同じ近さなら、表の先のもの）。
pub fn choice_within_the_range_is_closest_to_half_test() {
  simulation.pick_spectate_default([
    #(oni_cpu.Weak, 40, 0.2),
    #(oni_cpu.Normal, 40, 0.42),
    #(oni_cpu.Normal, 60, 0.55),
    #(oni_cpu.Strong, 40, 0.48),
    #(oni_cpu.Strong, 60, 0.52),
  ])
  |> should.equal(Ok(SpectateChoice(oni_cpu.Strong, 40, 0.48, True)))
}

/// 収まる組み合わせが無ければ、50% に最も近いものを、収まっていない印つきで返す。
pub fn choice_outside_the_range_is_marked_test() {
  simulation.pick_spectate_default([
    #(oni_cpu.Weak, 40, 0.1),
    #(oni_cpu.Strong, 100, 0.75),
    #(oni_cpu.Normal, 80, 0.3),
  ])
  |> should.equal(Ok(SpectateChoice(oni_cpu.Normal, 80, 0.3, False)))
}
