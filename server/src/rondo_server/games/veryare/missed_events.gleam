/// 見逃しポイントといいねの電文（issue-32 / ADR 0036）。
///
/// 形は TS の契約（packages/contracts/src/veryare.ts の VeryareSightEvent・VeryareLikeEvent・
/// VeryareLikesNotice）を正とし、共有の見本（fixtures/veryare-missed.json）を両方のテストで読む
/// （ADR 0009）。受け付けるか（探索中の鬼だけ・答え合わせの間だけ・1回まで）は状態機械が決める。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/list
import rondo_server/room/room_actor.{type PlayerId, PlayerId}

/// 鬼の視界の報告 { type: "sight", playerIds }。
pub fn sight_decoder() -> Decoder(List(String)) {
  use kind <- decode.field("type", decode.string)
  use ids <- decode.field("playerIds", decode.list(decode.string))
  case kind {
    "sight" -> decode.success(ids)
    _ -> decode.failure([], "sight")
  }
}

/// いいね { type: "like", target }。
pub fn like_decoder() -> Decoder(String) {
  use kind <- decode.field("type", decode.string)
  use target <- decode.field("target", decode.string)
  case kind {
    "like" -> decode.success(target)
    _ -> decode.failure("", "like")
  }
}

/// いいねの数の通知 { type: "likes", likes: [{ playerId, count }] }。
pub fn likes_payload(likes: List(#(PlayerId, Int))) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("likes")),
    #(
      dynamic.string("likes"),
      dynamic.list(
        list.map(likes, fn(entry) {
          let #(PlayerId(id), count) = entry
          dynamic.properties([
            #(dynamic.string("playerId"), dynamic.string(id)),
            #(dynamic.string("count"), dynamic.int(count)),
          ])
        }),
      ),
    ),
  ])
}

/// いいねの数の通知を読む（テスト用）。形が違えば Error。
pub fn decode_likes(value: Dynamic) -> Result(List(#(String, Int)), Nil) {
  let entry = {
    use id <- decode.field("playerId", decode.string)
    use count <- decode.field("count", decode.int)
    decode.success(#(id, count))
  }
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use likes <- decode.field("likes", decode.list(entry))
    case kind {
      "likes" -> decode.success(likes)
      _ -> decode.failure([], "likes")
    }
  }
  case decode.run(value, decoder) {
    Ok(likes) -> Ok(likes)
    Error(_) -> Error(Nil)
  }
}
