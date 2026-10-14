//// 見逃しポイントの計算（issue-32 / ADR 0036）。0.5 秒ごとの加算値を返す純粋関数。

import gleeunit/should
import rondo_server/games/veryare/missed.{Params}

/// 既定のパラメータ: 半径 6 m、圏内 +3、視界内 15、比率は真横 1.0・半径の端 0.3。
pub fn default_params_test() {
  missed.default
  |> should.equal(Params(
    radius: 6.0,
    in_range: 3,
    in_sight: 15,
    near_ratio: 1.0,
    edge_ratio: 0.3,
  ))
}

/// 圏外（半径より遠い）では加算しない。視界に入っていても 0。
pub fn out_of_range_is_zero_test() {
  missed.award(missed.default, 6.01, False) |> should.equal(0)
  missed.award(missed.default, 6.01, True) |> should.equal(0)
  missed.award(missed.default, 100.0, True) |> should.equal(0)
}

/// 圏内は +3、視界内は 15（足し算ではない）。鬼の真横（距離 0）では比率 1.0。
pub fn in_range_and_in_sight_at_zero_distance_test() {
  missed.award(missed.default, 0.0, False) |> should.equal(3)
  missed.award(missed.default, 0.0, True) |> should.equal(15)
}

/// 視界に入っている間は、圏内だけより高い（同じ距離で比べる）。
pub fn in_sight_is_higher_than_in_range_test() {
  [0.0, 1.5, 3.0, 4.5, 6.0]
  |> each(fn(d) {
    {
      missed.award(missed.default, d, True)
      > missed.award(missed.default, d, False)
    }
    |> should.be_true
  })
}

/// 距離による比率は、真横 1.0 から半径の端 0.3 へ線形に下がる。整数に丸める。
pub fn ratio_decreases_linearly_and_rounds_test() {
  // 半径の端（6 m）: 15 × 0.3 = 4.5 → 5（四捨五入）、3 × 0.3 = 0.9 → 1。端は圏内。
  missed.award(missed.default, 6.0, True) |> should.equal(5)
  missed.award(missed.default, 6.0, False) |> should.equal(1)
  // 真ん中（3 m）: 比率 0.65。15 × 0.65 = 9.75 → 10、3 × 0.65 = 1.95 → 2。
  missed.award(missed.default, 3.0, True) |> should.equal(10)
  missed.award(missed.default, 3.0, False) |> should.equal(2)
  // 4 m: 比率 1.0 - 0.7 × 4 / 6 ≈ 0.533。15 × 0.533 = 8.0 → 8。
  missed.award(missed.default, 4.0, True) |> should.equal(8)
}

/// 近いほど高い（距離が増えても、加算値は増えない）。
pub fn closer_is_never_lower_test() {
  [#(0.0, 1.0), #(1.0, 2.0), #(2.0, 3.0), #(3.0, 4.5), #(4.5, 6.0)]
  |> each(fn(pair) {
    let #(near, far) = pair
    {
      missed.award(missed.default, near, True)
      >= missed.award(missed.default, far, True)
    }
    |> should.be_true
  })
}

/// 半径・加算値・比率はパラメータで変えられる。
pub fn params_are_adjustable_test() {
  let params =
    Params(
      radius: 10.0,
      in_range: 4,
      in_sight: 20,
      near_ratio: 2.0,
      edge_ratio: 1.0,
    )
  missed.award(params, 0.0, True) |> should.equal(40)
  missed.award(params, 10.0, False) |> should.equal(4)
  missed.award(params, 10.5, True) |> should.equal(0)
}

/// 負の距離（呼び出し側の誤り）は、真横として扱う。
pub fn negative_distance_is_treated_as_zero_test() {
  missed.award(missed.default, -1.0, True) |> should.equal(15)
}

fn each(items: List(a), f: fn(a) -> Nil) -> Nil {
  case items {
    [] -> Nil
    [first, ..rest] -> {
      f(first)
      each(rest, f)
    }
  }
}
