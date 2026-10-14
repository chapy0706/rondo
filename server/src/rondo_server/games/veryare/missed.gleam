/// 見逃しポイント（issue-32 / ADR 0036）。0.5 秒ごとの加算値を求める純粋関数。勝敗には使わない。
///
/// - 鬼から半径 radius 以内を「圏内」とし、圏外では加算しない（半径ちょうどは圏内）
/// - 圏内にいる間は in_range、圏内かつ鬼の視界に入っている間は in_sight（足し算ではない）
/// - 鬼との距離に応じた比率を掛ける。真横で near_ratio、半径の端で edge_ratio の線形の減少
/// - 端数は四捨五入で整数に丸める
///
/// 半径・加算値・比率は、実際に遊んで調整する前提のパラメータ（ADR 0036 の「仮」の値が既定）。
import gleam/float
import gleam/int

pub type Params {
  Params(
    /// 圏内の半径（メートル）。
    radius: Float,
    /// 圏内だけのときの加算値。
    in_range: Int,
    /// 圏内かつ視界に入っているときの加算値。
    in_sight: Int,
    /// 鬼の真横（距離 0）の比率。
    near_ratio: Float,
    /// 半径の端の比率。
    edge_ratio: Float,
  )
}

/// ADR 0036 の仮の値（半径 6 m、+3 / 15、比率 1.0 → 0.3）。
pub const default = Params(
  radius: 6.0,
  in_range: 3,
  in_sight: 15,
  near_ratio: 1.0,
  edge_ratio: 0.3,
)

/// 0.5 秒ぶんの加算値。distance は鬼との水平の距離（メートル）、in_sight は鬼の視界に入っているか。
pub fn award(params: Params, distance: Float, in_sight: Bool) -> Int {
  let d = float.max(distance, 0.0)
  case d >. params.radius {
    True -> 0
    False -> {
      let base = case in_sight {
        True -> params.in_sight
        False -> params.in_range
      }
      let t = case params.radius >. 0.0 {
        True -> d /. params.radius
        False -> 0.0
      }
      let ratio =
        params.near_ratio -. { params.near_ratio -. params.edge_ratio } *. t
      float.round(int.to_float(base) *. ratio)
    }
  }
}
