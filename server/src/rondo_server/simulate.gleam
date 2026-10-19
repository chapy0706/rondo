/// 鬼 CPU と隠れ CPU だけの対戦を、骨格 × 強さ3種 × 種を変えて回し、集計を表で出す
/// （ADR 0038 / issue-34）。`make simulate`（cd server && gleam run -m rondo_server/simulate）。
///
/// 骨格は、ふつうの 10 種と、広い屋敷の 30 種（issue-65 / ADR 0048）。種類ごとに、強さごとの集計と、
/// 骨格 × 強さごとの集計を出し、最後に、種類どうしの比較（隠れ勝率・試合の平均の長さ・異常・計算時間）
/// と、異常の合計を出す。探索時間は、ルームで選ぶ時間で並べる（広い屋敷は、ルームと同じく +80 秒で
/// 回る）。歩く速さ・視野・発見確率は、この表を見て oni_cpu.params で調整する。
import gleam/int
import gleam/io
import gleam/list
import rondo_server/games/veryare/oni_cpu.{type Strength}
import rondo_server/games/veryare/simulation.{type Match}
import rondo_server/games/veryare/stage.{type Skeleton}
import rondo_server/games/veryare/stage_timing

/// 骨格 × 強さの組ごとに回す試合数。
const matches_per_case = 100

/// 強さを合わせる基準の探索時間（秒）。人間並の速さで、選択肢の最長（ADR 0024）。
const reference_seconds = 120

/// 強さごとの集計を並べる探索時間（秒。ルームで選ぶ時間）。
const compared_seconds = [40, 80, 120]

/// 骨格の種類ごとの結果。
type KindResult {
  KindResult(
    name: String,
    /// 探索時間ごとの、(強さ, 骨格の番号, 試合) の一覧。
    by_time: List(#(Int, List(#(Strength, Int, List(Match))))),
    /// 回すのにかかった時間（ミリ秒）。
    compute_ms: Int,
  )
}

pub fn main() -> Nil {
  io.println(
    "veryare シミュレーション（鬼 CPU 1 × 隠れ CPU "
    <> int.to_string(simulation.hider_count)
    <> "、骨格 × 強さごとに "
    <> int.to_string(matches_per_case)
    <> " 試合）",
  )
  let kinds = [
    run_kind("10 種", stage.skeletons()),
    run_kind("広い屋敷", stage.wide_skeletons()),
  ]
  list.each(kinds, print_kind)
  print_comparison(kinds)

  let anomalies =
    kinds
    |> list.flat_map(fn(kind) { kind.by_time })
    |> list.flat_map(fn(entry) { entry.1 })
    |> list.flat_map(fn(r) { r.2 })
    |> list.flat_map(fn(m) { m.anomalies })
  io.println("")
  io.println("異常: " <> int.to_string(list.length(anomalies)) <> " 件")
  list.each(list.unique(anomalies), fn(a) { io.println("  - " <> a) })
}

fn run_kind(name: String, skeletons: List(Skeleton)) -> KindResult {
  let started = monotonic_ms()
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
  KindResult(name:, by_time:, compute_ms: monotonic_ms() - started)
}

fn print_kind(kind: KindResult) -> Nil {
  list.each(kind.by_time, fn(entry) {
    let #(seconds, results) = entry
    io.println("")
    io.println(
      "■ "
      <> kind.name
      <> " 強さごと（探索 "
      <> int.to_string(seconds)
      <> " 秒"
      <> extra_note(kind)
      <> "）",
    )
    io.println(simulation.header)
    list.each(simulation.strengths(), fn(strength) {
      io.println(simulation.format_row(
        simulation.strength_name(strength),
        simulation.summarize(of_strength(results, strength)),
      ))
    })
  })

  io.println("")
  io.println(
    "■ "
    <> kind.name
    <> " 骨格 × 強さ（探索 "
    <> int.to_string(reference_seconds)
    <> " 秒"
    <> extra_note(kind)
    <> "）",
  )
  io.println(simulation.header)
  list.each(reference(kind), fn(r) {
    let #(strength, id, matches) = r
    io.println(simulation.format_row(
      "骨格" <> int.to_string(id) <> " " <> simulation.strength_name(strength),
      simulation.summarize(matches),
    ))
  })
}

/// 種類どうしの比較（基準の探索時間）。隠れ勝率・試合の平均の長さ・異常は強さごと、計算時間は種類ごと
/// （3 つの探索時間 × 強さ 3 種 × 骨格の数 × 試合数を回した時間）。
fn print_comparison(kinds: List(KindResult)) -> Nil {
  io.println("")
  io.println("■ 10 種と広い屋敷の比較（探索 " <> int.to_string(reference_seconds) <> " 秒）")
  io.println(simulation.comparison_header)
  list.each(kinds, fn(kind) {
    list.each(simulation.strengths(), fn(strength) {
      io.println(simulation.format_comparison(
        kind.name <> " " <> simulation.strength_name(strength),
        simulation.summarize(of_strength(reference(kind), strength)),
      ))
    })
  })
  list.each(kinds, fn(kind) {
    // 基準の探索時間の組（強さ × 骨格）の数 × 探索時間の数 × 試合数。
    let matches =
      list.length(reference(kind))
      * list.length(compared_seconds)
      * matches_per_case
    io.println(
      "計算時間 "
      <> kind.name
      <> ": "
      <> int.to_string(kind.compute_ms)
      <> " ms（"
      <> int.to_string(matches)
      <> " 試合。1 試合 "
      <> int.to_string(kind.compute_ms * 1000 / int.max(matches, 1))
      <> " µs）",
    )
  })
}

fn extra_note(kind: KindResult) -> String {
  case kind.name {
    "広い屋敷" ->
      "。実際は +"
      <> int.to_string(stage_timing.wide_extra_exploration_seconds)
      <> " 秒"
    _ -> ""
  }
}

fn reference(kind: KindResult) -> List(#(Strength, Int, List(Match))) {
  case list.key_find(kind.by_time, reference_seconds) {
    Ok(results) -> results
    Error(Nil) -> []
  }
}

fn of_strength(
  results: List(#(Strength, Int, List(Match))),
  strength: Strength,
) -> List(Match) {
  results
  |> list.filter(fn(r) { r.0 == strength })
  |> list.flat_map(fn(r) { r.2 })
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

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int
