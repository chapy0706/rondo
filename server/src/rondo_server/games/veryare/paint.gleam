/// 人間の隠れ側のペイント（ADR 0025・0037 / issue-25・issue-54）。
///
/// 描き込み面は5本の円柱（胴・左腕・右腕・左脚・右脚）で、面の上の位置は、部位ごとに、円柱を
/// 回る角度 u（0〜1）と軸の向きの位置 v（0〜1）。ペイントフェーズの終わりに隠れ側が一度だけ送り（契約: VeryarePaintEvent）、
/// サーバーは探索の開始の一括配信に、そのまま載せる。
///
/// 電文の大きさを抑えるため、本数と点の数に上限を置く。値はクライアントと同じで、共有の見本
/// （packages/contracts/src/fixtures/veryare-paint.json の limits）で一致を確かめる。
/// 上限や形に合わないペイントは、丸ごと捨てる。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None}
import gleam/string
import rondo_server/games/veryare/palette.{type Rgb, Rgb}
import rondo_server/games/veryare/pose

/// ストロークの本数の上限。
pub const max_strokes = 100

/// 点の数（全ストロークの合計）の上限。
pub const max_points = 1000

/// ブラシの半径の下限と上限（u・v の単位）。
pub const min_size = 0.01

pub const max_size = 0.15

/// 描き込み面の部位（5本円柱 / ADR 0037）。胴は頭を含む。
pub type Part {
  Torso
  LeftArm
  RightArm
  LeftLeg
  RightLeg
}

/// 契約の部位の名前（VeryarePaintPart）。一覧に無い名前は Error。
pub fn parse_part(name: String) -> Result(Part, Nil) {
  case name {
    "torso" -> Ok(Torso)
    "left-arm" -> Ok(LeftArm)
    "right-arm" -> Ok(RightArm)
    "left-leg" -> Ok(LeftLeg)
    "right-leg" -> Ok(RightLeg)
    _ -> Error(Nil)
  }
}

fn part_name(part: Part) -> String {
  case part {
    Torso -> "torso"
    LeftArm -> "left-arm"
    RightArm -> "right-arm"
    LeftLeg -> "left-leg"
    RightLeg -> "right-leg"
  }
}

/// 1本のストローク。色は "#rrggbb"（小文字）、点は #(u, v)。
pub type Stroke {
  Stroke(part: Part, color: String, size: Float, points: List(#(Float, Float)))
}

/// ペイントの確定の中身。塗っていなければ strokes は None、ポーズを変えていなければ pose は None。
pub type Confirm {
  Confirm(strokes: Option(List(Stroke)), pose: Option(String))
}

/// ペイントの確定 { type: "paint", paint: { kind: "strokes", strokes } | null, pose?: id | null }
/// （pose は issue-56）。一覧に無い pose は None と同じ。paint と pose が両方 None なら拒む（捨てる）。
pub fn event_decoder() -> decode.Decoder(Confirm) {
  use kind <- decode.field("type", decode.string)
  case kind {
    "paint" -> {
      use strokes <- decode.field("paint", decode.optional(paint_decoder()))
      use raw <- decode.optional_field(
        "pose",
        None,
        decode.optional(decode.string),
      )
      let chosen = option.then(raw, pose.parse)
      case strokes, chosen {
        None, None -> decode.failure(Confirm(None, None), "paint")
        _, _ -> decode.success(Confirm(strokes, chosen))
      }
    }
    _ -> decode.failure(Confirm(None, None), "paint")
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
    parse_part(part),
    is_color(color) && size >=. min_size && size <=. max_size && points != []
  {
    Ok(part), True -> decode.success(Stroke(part, color, size, points))
    _, _ -> decode.failure(fallback, "stroke")
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

// --- 平均色（鬼 CPU の溶け込み度 / issue-54） ----------------------------------------

const pi = 3.141592653589793

const parts = [Torso, LeftArm, RightArm, LeftLeg, RightLeg]

/// 部位の大きさの重み（体の上での広さの概算。周の長さ × 長さを、胴を 1 として比べたもの）。
/// 部位の描き込み面は、どれも u・v が 0〜1 の面（面積 1）なので、体の上の広さに直すために掛ける。
fn part_weight(part: Part) -> Float {
  case part {
    Torso -> 1.0
    LeftArm | RightArm -> 0.1
    LeftLeg | RightLeg -> 0.2
  }
}

/// 1本のストロークの、描き込み面の上の面積の近似（点の数 × π × 半径²。点の重なりは数えない）。
fn stroke_area(stroke: Stroke) -> Float {
  int.to_float(list.length(stroke.points)) *. pi *. stroke.size *. stroke.size
}

/// 塗った割合（0〜1）。部位ごとに、面積の合計を 1 で止め、部位の重みで合わせる（重なりは
/// 数えないので、近似）。
pub fn coverage(strokes: List(Stroke)) -> Float {
  let #(painted, total) =
    list.fold(parts, #(0.0, 0.0), fn(acc, part) {
      let area =
        strokes
        |> list.filter(fn(s) { s.part == part })
        |> list.fold(0.0, fn(sum, s) { sum +. stroke_area(s) })
      let weight = part_weight(part)
      #(acc.0 +. weight *. float.min(1.0, area), acc.1 +. weight)
    })
  painted /. total
}

/// ペイントの平均色。ストロークの面積（部位の重みを掛けたもの）で重みを付けた平均色に、塗っていない体の色を、塗っていない
/// 割合だけ混ぜる。塗っていなければ、塗っていない体の色。
pub fn average_color(strokes: List(Stroke)) -> Rgb {
  let #(weight, r, g, b) =
    list.fold(strokes, #(0.0, 0.0, 0.0, 0.0), fn(acc, stroke) {
      let area = stroke_area(stroke) *. part_weight(stroke.part)
      let Rgb(cr, cg, cb) = rgb_of(stroke.color)
      #(
        acc.0 +. area,
        acc.1 +. area *. int.to_float(cr),
        acc.2 +. area *. int.to_float(cg),
        acc.3 +. area *. int.to_float(cb),
      )
    })
  case weight >. 0.0 {
    False -> palette.unpainted
    True -> {
      let painted = coverage(strokes)
      let mix = fn(sum: Float, base: Int) {
        float.round(
          painted *. sum /. weight +. { 1.0 -. painted } *. int.to_float(base),
        )
      }
      Rgb(
        mix(r, palette.unpainted.r),
        mix(g, palette.unpainted.g),
        mix(b, palette.unpainted.b),
      )
    }
  }
}

/// "#rrggbb" を色にする（受け付けたストロークは is_color を通っている）。
fn rgb_of(color: String) -> Rgb {
  let channel = fn(start: Int) {
    case int.base_parse(string.slice(color, start, 2), 16) {
      Ok(value) -> value
      Error(Nil) -> 0
    }
  }
  Rgb(channel(1), channel(3), channel(5))
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
  dynamic.properties([
    #(dynamic.string("part"), dynamic.string(part_name(stroke.part))),
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
