/// 動く隠れ側の通知と、見た目の通知（動ける隠れ側の規則 / ADR 0053）。
///
/// 形は TS の契約（packages/contracts/src/veryare.ts の VeryareRoamingNotice・VeryareLookNotice）を正とし、
/// 共有の見本（fixtures/veryare-roaming.json）を両方のテストで読む（ADR 0009）。何を載せるか（規則・
/// フェーズ・人間だけ・丸め）は状態機械（game.roaming_hiders・game.look）が決め、ここは電文の組み立てと
/// 読み取りだけを受け持つ。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import rondo_server/games/veryare/game.{type RoamingHider}
import rondo_server/games/veryare/paint
import rondo_server/games/veryare/pose
import rondo_server/room/room_actor.{type PlayerId, PlayerId}

/// 読み取った動く隠れ側 1 人（テストの確かめに使う形）。
pub type Hider {
  Hider(player_id: String, x: Float, z: Float, facing: Option(Float))
}

/// 読み取った見た目の通知（テストの確かめに使う形）。
pub type Look {
  Look(
    player_id: String,
    pose: Option(String),
    strokes: Option(List(paint.Stroke)),
  )
}

/// { type: "roaming", hiders: [{ playerId, x, z, facing }] }。
pub fn payload(hiders: List(RoamingHider(PlayerId))) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("roaming")),
    #(dynamic.string("hiders"), hiders_payload(hiders)),
  ])
}

/// [{ playerId, x, z, facing }]。動く隠れ側の通知と、増え鬼の鬼の通知の others が使う。
pub fn hiders_payload(hiders: List(RoamingHider(PlayerId))) -> Dynamic {
  dynamic.list(
    list.map(hiders, fn(hider) {
      let PlayerId(id) = hider.player
      dynamic.properties([
        #(dynamic.string("playerId"), dynamic.string(id)),
        #(dynamic.string("x"), dynamic.float(hider.x)),
        #(dynamic.string("z"), dynamic.float(hider.z)),
        #(dynamic.string("facing"), case hider.facing {
          Some(facing) -> dynamic.float(facing)
          None -> dynamic.nil()
        }),
      ])
    }),
  )
}

/// { type: "look", playerId, pose, paint }。いまの見た目（無ければ null）。
pub fn look_payload(
  player: PlayerId,
  chosen: Option(String),
  strokes: Option(List(paint.Stroke)),
) -> Dynamic {
  let PlayerId(id) = player
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("look")),
    #(dynamic.string("playerId"), dynamic.string(id)),
    #(dynamic.string("pose"), case chosen {
      Some(name) -> dynamic.string(name)
      None -> dynamic.nil()
    }),
    #(dynamic.string("paint"), case strokes {
      Some(list) -> paint.payload(list)
      None -> dynamic.nil()
    }),
  ])
}

/// 動く隠れ側の通知を読む。形が違えば Error。
pub fn decode_notice(value: Dynamic) -> Result(List(Hider), Nil) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use hiders <- decode.field("hiders", decode.list(hider_decoder()))
    case kind {
      "roaming" -> decode.success(hiders)
      _ -> decode.failure([], "roaming")
    }
  }
  case decode.run(value, decoder) {
    Ok(hiders) -> Ok(hiders)
    Error(_) -> Error(Nil)
  }
}

/// 見た目の通知を読む。一覧（pose.gleam）に無いポーズ・形の違うペイントは Error。
pub fn decode_look(value: Dynamic) -> Result(Look, Nil) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use player_id <- decode.field("playerId", decode.string)
    use raw <- decode.field("pose", decode.optional(decode.string))
    use strokes <- decode.field("paint", decode.optional(paint.paint_decoder()))
    let fallback = Look("", None, None)
    case kind, raw {
      "look", None -> decode.success(Look(player_id:, pose: None, strokes:))
      "look", Some(value) ->
        case pose.parse(value) {
          Some(chosen) ->
            decode.success(Look(player_id:, pose: Some(chosen), strokes:))
          None -> decode.failure(fallback, "pose")
        }
      _, _ -> decode.failure(fallback, "look")
    }
  }
  decode.run(value, decoder) |> result.replace_error(Nil)
}

/// 鬼の通知の others（増え鬼の、途中から鬼になった人 / ADR 0053）を読む。載っていなければ None。
/// 形が違えば Error（鬼の通知のほかの項目は、ここでは見ない）。
pub fn decode_others(value: Dynamic) -> Result(Option(List(Hider)), Nil) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use others <- decode.optional_field(
      "others",
      None,
      decode.map(decode.list(hider_decoder()), Some),
    )
    case kind {
      "oni" -> decode.success(others)
      _ -> decode.failure(None, "oni")
    }
  }
  decode.run(value, decoder) |> result.replace_error(Nil)
}

fn hider_decoder() -> Decoder(Hider) {
  use player_id <- decode.field("playerId", decode.string)
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  use facing <- decode.field("facing", decode.optional(number()))
  decode.success(Hider(player_id:, x:, z:, facing:))
}

/// 数値（整数でも小数でも）。
fn number() -> Decoder(Float) {
  decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
}
