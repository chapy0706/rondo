/// 待機ルームのメンバーの通知と、待機ポーズの変更の電文（issue-59 / ADR 0044）。
///
/// 形は TS の契約（packages/contracts/src/veryare.ts の VeryareMembersNotice・VeryareWaitingPoseEvent）
/// を正とし、共有の見本（fixtures/veryare-members.json）を両方のテストで読む（ADR 0009）。
/// 何を載せるか（人間だけ・鬼選出の間だけ・丸め）は状態機械（game.waiting_members）が決め、ここは
/// 電文の組み立てと読み取りだけを受け持つ。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import rondo_server/games/veryare/game.{type WaitingMember}
import rondo_server/games/veryare/pose
import rondo_server/room/room_actor.{type PlayerId, PlayerId}

/// 読み取ったメンバー1人（テストとボットの確かめに使う形）。
pub type Member {
  Member(
    player_id: String,
    x: Float,
    z: Float,
    facing: Option(Float),
    pose: Option(String),
  )
}

/// { type: "members", members: [{ playerId, x, z, facing, pose }] }。名前は載せない。
pub fn payload(members: List(WaitingMember(PlayerId))) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("members")),
    #(
      dynamic.string("members"),
      dynamic.list(
        members
        |> list.map(fn(member) {
          let PlayerId(id) = member.player
          dynamic.properties([
            #(dynamic.string("playerId"), dynamic.string(id)),
            #(dynamic.string("x"), dynamic.float(member.x)),
            #(dynamic.string("z"), dynamic.float(member.z)),
            #(dynamic.string("facing"), optional(member.facing, dynamic.float)),
            #(dynamic.string("pose"), optional(member.pose, dynamic.string)),
          ])
        }),
      ),
    ),
  ])
}

/// メンバーの通知を読む。形が違えば Error。
pub fn decode_notice(value: Dynamic) -> Result(List(Member), Nil) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use members <- decode.field("members", decode.list(member_decoder()))
    case kind {
      "members" -> decode.success(members)
      _ -> decode.failure([], "members")
    }
  }
  case decode.run(value, decoder) {
    Ok(members) -> Ok(members)
    Error(_) -> Error(Nil)
  }
}

/// 待機ポーズの変更 { type: "waiting-pose", pose }。一覧（pose.gleam）に無い識別子は拒む。
pub fn waiting_pose_decoder() -> Decoder(String) {
  use kind <- decode.field("type", decode.string)
  use value <- decode.field("pose", decode.string)
  case kind, pose.parse(value) {
    "waiting-pose", Some(chosen) -> decode.success(chosen)
    _, _ -> decode.failure("", "waiting-pose")
  }
}

fn member_decoder() -> Decoder(Member) {
  use player_id <- decode.field("playerId", decode.string)
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  use facing <- decode.field("facing", decode.optional(number()))
  use raw <- decode.field("pose", decode.optional(decode.string))
  case raw {
    None -> decode.success(Member(player_id:, x:, z:, facing:, pose: None))
    Some(value) ->
      case pose.parse(value) {
        Some(chosen) ->
          decode.success(Member(player_id:, x:, z:, facing:, pose: Some(chosen)))
        None -> decode.failure(Member("", 0.0, 0.0, None, None), "pose")
      }
  }
}

/// 数値（整数でも小数でも）。
fn number() -> Decoder(Float) {
  decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
}

fn optional(value: Option(a), encode: fn(a) -> Dynamic) -> Dynamic {
  case value {
    Some(inner) -> encode(inner)
    None -> dynamic.nil()
  }
}
