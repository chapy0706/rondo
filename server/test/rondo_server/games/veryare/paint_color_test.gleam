/// 人間のペイントの平均色（issue-54）。鬼 CPU の溶け込み度に使う。ストロークの面積（点の数 × π ×
/// 半径²。重なりは数えない）に部位の大きさの重み（胴 1.0・腕 0.1・脚 0.2）を掛けた平均色に、
/// 塗っていない部分（塗っていない体の色）を、塗っていない割合だけ混ぜる。塗った割合は、部位ごとに
/// 1 で止めてから、部位の重みで合わせる。
import gleam/dict
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{type Game}
import rondo_server/games/veryare/hider_cpu
import rondo_server/games/veryare/paint.{
  LeftArm, LeftLeg, RightArm, RightLeg, Stroke, Torso,
}
import rondo_server/games/veryare/palette.{Rgb}
import rondo_server/games/veryare/stage

/// 半径 0.15 の点を n 個（1 点の面積は約 0.0707。15 点で部位の面積 1 を超える）。
fn big(part: paint.Part, color: String, n: Int) -> paint.Stroke {
  Stroke(part, color, 0.15, list.repeat(#(0.5, 0.5), n))
}

/// 5部位すべてに、同じ塗り方。
fn everywhere(color: String, n: Int) -> List(paint.Stroke) {
  list.map([Torso, LeftArm, RightArm, LeftLeg, RightLeg], big(_, color, n))
}

/// 塗っていなければ、塗っていない体の色。
pub fn no_strokes_is_unpainted_test() {
  paint.average_color([]) |> should.equal(palette.unpainted)
  paint.coverage([]) |> should.equal(0.0)
}

/// 5部位を覆うほど塗れば、塗った色そのもの（割合は 1 で止まる）。
pub fn full_coverage_is_the_stroke_color_test() {
  paint.coverage(everywhere("#a07850", 20)) |> should.equal(1.0)
  paint.average_color(everywhere("#a07850", 20))
  |> should.equal(Rgb(160, 120, 80))
}

/// 塗った割合は部位ごとに 1 で止める（胴を塗り重ねても、腕・脚を塗ったことにはならない）。
/// 胴だけを覆えば 1.0 / 1.6、左腕だけなら 0.1 / 1.6。
pub fn coverage_is_capped_per_part_and_weighted_test() {
  let torso = paint.coverage([big(Torso, "#000000", 100)])
  { torso >. 0.6249 && torso <. 0.6251 } |> should.be_true
  let arm = paint.coverage([big(LeftArm, "#000000", 100)])
  { arm >. 0.0624 && arm <. 0.0626 } |> should.be_true
  let leg = paint.coverage([big(RightLeg, "#000000", 100)])
  { leg >. 0.1249 && leg <. 0.1251 } |> should.be_true
}

/// 胴だけのペイント（issue-25 の形）も、胴の重みで数える。
pub fn torso_only_paint_still_counts_test() {
  let color = paint.average_color([big(Torso, "#000000", 100)])
  // 黒 0.625 と、塗っていない色 (236, 232, 245) の 0.375 ≒ (88.5, 87, 91.9)。
  { color.r >= 88 && color.r <= 89 } |> should.be_true
  color.g |> should.equal(87)
  color.b |> should.equal(92)
}

/// 小さく塗っただけなら、ほとんど塗っていない体の色。
pub fn small_stroke_is_mostly_unpainted_test() {
  let color =
    paint.average_color([Stroke(Torso, "#000000", 0.04, [#(0.5, 0.5)])])
  // 塗った割合は π × 0.04² ≒ 0.005。
  palette.difference(color, palette.unpainted)
  |> fn(d) { d <. 0.01 }
  |> should.be_true
}

/// 面積で重みを付ける。同じ面積なら、ちょうど中間。
pub fn equal_areas_average_the_colors_test() {
  paint.average_color(list.append(
    everywhere("#000000", 10),
    everywhere("#ffffff", 10),
  ))
  |> should.equal(Rgb(128, 128, 128))
}

/// 大きく塗った色ほど、平均色に効く。
pub fn larger_area_weighs_more_test() {
  let color =
    paint.average_color(list.append(
      everywhere("#ff0000", 15),
      everywhere("#0000ff", 5),
    ))
  // 赤 3 : 青 1。
  color |> should.equal(Rgb(191, 0, 64))
}

/// どの部位も半分ほど塗れば、塗った色と塗っていない色の、ほぼ中間。
pub fn partial_coverage_mixes_with_unpainted_test() {
  // 半径 0.1 の点 1 個の面積は π × 0.01 ≒ 0.0314。16 点で約 0.503。
  let strokes =
    list.map([Torso, LeftArm, RightArm, LeftLeg, RightLeg], fn(part) {
      Stroke(part, "#000000", 0.1, list.repeat(#(0.5, 0.5), 16))
    })
  let coverage = paint.coverage(strokes)
  { coverage >. 0.49 && coverage <. 0.51 } |> should.be_true
  let color = paint.average_color(strokes)
  // 塗っていない色 (236, 232, 245) の約半分。
  { color.r >= 114 && color.r <= 120 } |> should.be_true
  { color.b >= 119 && color.b <= 124 } |> should.be_true
}

// --- 鬼 CPU が見る隠れ側の色 -----------------------------------------------------

fn exploring() -> Game(String) {
  let base =
    game.new(
      ["a", "b", "c"],
      game.durations(exploration_ms: 40_000),
      stage.generate(0),
    )
  game.Game(
    ..base,
    phase: game.Exploration,
    still_hiding: set.from_list(["b", "c"]),
  )
}

/// 人間の隠れ側は、確定したペイントの平均色。塗っていなければ、塗っていない体の色。
pub fn human_hider_color_uses_the_paint_test() {
  let g =
    game.Game(
      ..exploring(),
      paints: dict.from_list([#("b", everywhere("#a07850", 20))]),
    )
  game.hider_color(g, "b") |> should.equal(Rgb(160, 120, 80))
  game.hider_color(g, "c") |> should.equal(palette.unpainted)
}

/// CPU の隠れ側は、これまでどおり CPU の置き方の色。
pub fn cpu_hider_color_is_unchanged_test() {
  let placement =
    hider_cpu.Placement(
      x: 1.0,
      z: 1.0,
      facing: 0.0,
      pose: hider_cpu.Standing,
      color: Rgb(1, 2, 3),
    )
  let g =
    game.Game(..exploring(), cpu_states: dict.from_list([#("c", placement)]))
  game.hider_color(g, "c") |> should.equal(Rgb(1, 2, 3))
}
