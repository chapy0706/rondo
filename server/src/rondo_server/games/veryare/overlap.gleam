/// 隠れ側同士の被り判定（ADR 0026 の被り判定の部分）。
///
/// 各プレイヤーに半径 radius の球を持たせ、全員分の距離を総当たりで判定する。
/// 位置は床の上（x, z）で、高さは同じとみなす。中心間の距離が直径未満なら重なりとし、
/// 重なった相手を問わず全員を返す（ちょうど接しているだけは重なりではない）。
import gleam/list
import gleam/set.{type Set}

/// 球の半径（メートル）。実際に歩いて調整する前の仮の値。
pub const radius = 0.3

/// 他の誰かと球が重なっているプレイヤー。
pub fn overlapping(players: List(#(id, Float, Float))) -> Set(id) {
  let diameter = radius *. 2.0
  players
  |> list.combination_pairs
  |> list.fold(set.new(), fn(found, pair) {
    let #(#(a, ax, az), #(b, bx, bz)) = pair
    let dx = ax -. bx
    let dz = az -. bz
    case dx *. dx +. dz *. dz <. diameter *. diameter {
      True -> found |> set.insert(a) |> set.insert(b)
      False -> found
    }
  })
}
