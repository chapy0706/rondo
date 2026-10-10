/// 人間の隠れ側のペイント（ADR 0025・0037 の簡略版 / issue-25）。
///
/// 描き込み面は胴（体全体）の円柱1本で、面の上の位置は、円柱を回る角度 u（0〜1）と
/// 高さ v（0〜1）。ペイントフェーズの終わりに隠れ側が一度だけ送り（契約: VeryarePaintEvent）、
/// サーバーは探索の開始の一括配信に、そのまま載せる。
///
/// 電文の大きさを抑えるため、本数と点の数に上限を置く。値はクライアントと同じで、共有の見本
/// （packages/contracts/src/fixtures/veryare-paint.json の limits）で一致を確かめる。
/// 上限や形に合わないペイントは、丸ごと捨てる。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/string

/// ストロークの本数の上限。
pub const max_strokes = 100

/// 点の数（全ストロークの合計）の上限。
pub const max_points = 1000

/// ブラシの半径の下限と上限（u・v の単位）。
pub const min_size = 0.01

pub const max_size = 0.15

/// 描き込み面の部位。5本円柱（ADR 0037）で腕・脚を足す。
pub type Part {
  Torso
}

/// 1本のストローク。色は "#rrggbb"（小文字）、点は #(u, v)。
pub type Stroke {
  Stroke(part: Part, color: String, size: Float, points: List(#(Float, Float)))
}

/// ペイントの確定 { type: "paint", paint: { kind: "strokes", strokes } }。
pub fn event_decoder() -> decode.Decoder(List(Stroke)) {
  use kind <- decode.field("type", decode.string)
  case kind {
    "paint" -> decode.field("paint", paint_decoder(), decode.success)
    _ -> decode.failure([], "paint")
  }
}

/// ペイント { kind: "strokes", strokes }。本数・点の数の上限を超えたら、丸ごと拒む。
pub fn paint_decoder() -> decode.Decoder(List(Stroke)) {
  use kind <- decode.field("kind", decode.string)
  use strokes <- decode.field("strokes", decode.list(stroke_decoder()))
  let points =
    list.fold(strokes, 0, fn(total, stroke) {
      total + list.length(stroke.points)
    })
  let count = list.length(strokes)
  case kind == "strokes" && count >= 1 && count <= max_strokes {
    True ->
      case points <= max_points {
        True -> decode.success(strokes)
        False -> decode.failure([], "paint")
      }
    False -> decode.failure([], "paint")
  }
}

fn stroke_decoder() -> decode.Decoder(Stroke) {
  let fallback = Stroke(Torso, "", 0.0, [])
  use part <- decode.field("part", decode.string)
  use color <- decode.field("color", decode.string)
  use size <- decode.field("size", number())
  use points <- decode.field("points", decode.list(point_decoder()))
  case
    part == "torso"
    && is_color(color)
    && size >=. min_size
    && size <=. max_size
    && points != []
  {
    True -> decode.success(Stroke(Torso, color, size, points))
    False -> decode.failure(fallback, "stroke")
  }
}

fn point_decoder() -> decode.Decoder(#(Float, Float)) {
  use u <- decode.field("u", number())
  use v <- decode.field("v", number())
  case unit(u) && unit(v) {
    True -> decode.success(#(u, v))
    False -> decode.failure(#(0.0, 0.0), "point")
  }
}

fn unit(value: Float) -> Bool {
  value >=. 0.0 && value <=. 1.0
}

/// "#rrggbb"（小文字の16進）。
fn is_color(color: String) -> Bool {
  case string.pop_grapheme(color) {
    Ok(#("#", hex)) ->
      string.length(hex) == 6
      && list.all(string.to_graphemes(hex), fn(c) {
        string.contains("0123456789abcdef", c)
      })
    _ -> False
  }
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
}

/// 一括配信に載せる形（契約: VeryareStrokesPaint）。
pub fn payload(strokes: List(Stroke)) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("kind"), dynamic.string("strokes")),
    #(
      dynamic.string("strokes"),
      dynamic.list(list.map(strokes, stroke_payload)),
    ),
  ])
}

fn stroke_payload(stroke: Stroke) -> Dynamic {
  let part = case stroke.part {
    Torso -> "torso"
  }
  dynamic.properties([
    #(dynamic.string("part"), dynamic.string(part)),
    #(dynamic.string("color"), dynamic.string(stroke.color)),
    #(dynamic.string("size"), dynamic.float(stroke.size)),
    #(
      dynamic.string("points"),
      dynamic.list(
        list.map(stroke.points, fn(p) {
          dynamic.properties([
            #(dynamic.string("u"), dynamic.float(p.0)),
            #(dynamic.string("v"), dynamic.float(p.1)),
          ])
        }),
      ),
    ),
  ])
}
