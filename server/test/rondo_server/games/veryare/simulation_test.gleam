import gleam/list
import gleeunit/should
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/simulation
import rondo_server/games/veryare/stage

/// どの骨格・強さでも、試合は終了まで進み、異常（ADR 0028）が出ない。
pub fn matches_finish_without_anomalies_test() {
  list.each(stage.skeletons(), fn(skeleton) {
    list.each(simulation.strengths(), fn(strength) {
      list.each([1, 2], fn(seed) {
        let m = simulation.run(skeleton, strength, seed, 120_000)
        m.finished |> should.be_true
        m.anomalies |> should.equal([])
        { list.length(m.find_seconds) <= simulation.hider_count }
        |> should.be_true
      })
    })
  })
}

/// 種を固定すれば、同じ試合になる。
pub fn same_seed_gives_the_same_match_test() {
  let assert [skeleton, ..] = stage.skeletons()
  simulation.run(skeleton, oni_cpu.Normal, 5, 120_000)
  |> should.equal(simulation.run(skeleton, oni_cpu.Normal, 5, 120_000))
}

/// 強さの順（よわい < ふつう < つよい）が、隠れ側の勝率に表れる。
pub fn stronger_oni_wins_more_often_test() {
  let rate = fn(strength) {
    stage.skeletons()
    |> list.flat_map(fn(skeleton) {
      list.map([1, 2, 3, 4, 5, 6], fn(seed) {
        simulation.run(skeleton, strength, seed, 120_000)
      })
    })
    |> simulation.summarize
    |> fn(s) { s.hider_win_rate }
  }
  let weak = rate(oni_cpu.Weak)
  let normal = rate(oni_cpu.Normal)
  let strong = rate(oni_cpu.Strong)
  { weak >. normal && normal >. strong } |> should.be_true
}
