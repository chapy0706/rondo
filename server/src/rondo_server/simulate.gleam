/// 鬼 CPU と隠れ CPU だけの対戦を、骨格10種 × 強さ3種 × 種を変えて回し、集計を表で出す
/// （ADR 0038 / issue-34）。`make simulate`（cd server && gleam run -m rondo_server/simulate）。
///
/// 出力: 強さごとの集計、骨格 × 強さごとの集計、異常の合計。歩く速さ・視野・発見確率は
/// この表を見て oni_cpu.params で調整する。
import gleam/int
import gleam/io
import gleam/list
import rondo_server/games/veryare/simulation
import rondo_server/games/veryare/stage

/// 骨格 × 強さの組ごとに回す試合数。
const matches_per_case = 100

/// 強さを合わせる基準の探索時間（秒）。人間並の速さで、選択肢の最長（ADR 0024）。
const reference_seconds = 120

/// 強さごとの集計を並べる探索時間（秒）。
const compared_seconds = [40, 80, 120]

pub fn main() -> Nil {
  let skeletons = stage.skeletons()
  let run_all = fn(seconds) {
    list.flat_map(simulation.strengths(), fn(strength) {
      list.map(skeletons, fn(skeleton) {
        let matches =
          list.map(seeds(matches_per_case), fn(seed) {
            simulation.run(skeleton, strength, seed, seconds * 1000)
          })
        #(strength, skeleton.id, matches)
      })
    })
  }
  let by_time =
    list.map(compared_seconds, fn(seconds) { #(seconds, run_all(seconds)) })

  io.println(
    "veryare シミュレーション（鬼 CPU 1 × 隠れ CPU "
    <> int.to_string(simulation.hider_count)
    <> "、骨格 × 強さごとに "
    <> int.to_string(matches_per_case)
    <> " 試合）",
  )
  list.each(by_time, fn(entry) {
    let #(seconds, results) = entry
    io.println("")
    io.println("■ 強さごと（探索 " <> int.to_string(seconds) <> " 秒）")
    io.println(simulation.header)
    list.each(simulation.strengths(), fn(strength) {
      let matches =
        results
        |> list.filter(fn(r) { r.0 == strength })
        |> list.flat_map(fn(r) { r.2 })
      io.println(simulation.format_row(
        simulation.strength_name(strength),
        simulation.summarize(matches),
      ))
    })
  })

  let reference = case list.key_find(by_time, reference_seconds) {
    Ok(results) -> results
    Error(Nil) -> []
  }
  io.println("")
  io.println("■ 骨格 × 強さ（探索 " <> int.to_string(reference_seconds) <> " 秒）")
  io.println(simulation.header)
  list.each(reference, fn(r) {
    let #(strength, id, matches) = r
    io.println(simulation.format_row(
      "骨格" <> int.to_string(id) <> " " <> simulation.strength_name(strength),
      simulation.summarize(matches),
    ))
  })

  let anomalies =
    by_time
    |> list.flat_map(fn(entry) { entry.1 })
    |> list.flat_map(fn(r) { r.2 })
    |> list.flat_map(fn(m) { m.anomalies })
  io.println("")
  io.println("異常: " <> int.to_string(list.length(anomalies)) <> " 件")
  list.each(list.unique(anomalies), fn(a) { io.println("  - " <> a) })
}

fn seeds(count: Int) -> List(Int) {
  do_seeds(count, [])
}

fn do_seeds(n: Int, acc: List(Int)) -> List(Int) {
  case n <= 0 {
    True -> acc
    False -> do_seeds(n - 1, [n, ..acc])
  }
}
