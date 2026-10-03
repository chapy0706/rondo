/// 部屋タイプごとの代表色と、色の差（ADR 0038 / issue-33）。
///
/// サーバーには描画が無いので、隠れ側が周囲に溶け込んでいるかは、ペイントの平均色と
/// その場の代表色の差で近似する。差は 0（同じ色）〜 1（黒と白）に正規化する。
/// 代表色は仮の値で、モデルと素材がそろったら平均色を取って合わせ直す。
import gleam/float
import gleam/int
import gleam/list
import gleam/string
import rondo_server/games/veryare/stage.{
  type RoomType, Oshiire, Washitsu, WashitsuWithKakejiku, WashitsuWithOshiire,
}

/// 色（各 0〜255）。
pub type Rgb {
  Rgb(r: Int, g: Int, b: Int)
}

/// 部屋タイプの代表色（仮の値）。
pub fn room_color(room: RoomType) -> Rgb {
  case room {
    // 畳と土壁の、くすんだ黄緑。
    Washitsu -> Rgb(181, 164, 106)
    WashitsuWithOshiire -> Rgb(168, 149, 106)
    // 床の間の、明るい砂色。
    WashitsuWithKakejiku -> Rgb(194, 178, 128)
    // 押し入れの、暗い木の色。
    Oshiire -> Rgb(107, 84, 64)
  }
}

/// 2色の差を 0〜1 に正規化する。RGB の空間での距離を、黒と白の距離で割る。
pub fn difference(a: Rgb, b: Rgb) -> Float {
  let dr = a.r - b.r
  let dg = a.g - b.g
  let db = a.b - b.b
  let squared = int.to_float(dr * dr + dg * dg + db * db)
  let assert Ok(ratio) = float.square_root(squared /. { 3.0 *. 255.0 *. 255.0 })
  ratio
}

/// 配信用に "#rrggbb" で書く。
pub fn to_hex(color: Rgb) -> String {
  "#"
  <> list.map([color.r, color.g, color.b], fn(channel) {
    channel
    |> int.clamp(0, 255)
    |> int.to_base16
    |> string.lowercase
    |> string.pad_start(2, "0")
  })
  |> string.concat
}
