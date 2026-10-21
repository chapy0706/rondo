//// 観戦用の通知（issue-67）。観戦ルームの観戦者にだけ送る、全員の位置・向き・ポーズ。
////
//// { type: "spectate", actors: [{ playerId, x, z, facing, pose }], looks?: [{ playerId, pose, paint }] }
////
//// - actors は、ステージに出ている全員。隠れ CPU（参加順）と、探索の開始からは鬼 CPU（最後）
//// - 準備移動の間、歩いている隠れ CPU は、歩きの位置（hider_cpu.position_at）で、進む向きを向き、ポーズは
////   walking。着いたら（と、準備移動の後は）、隠れ場所の位置・向き・ポーズ
//// - looks は、隠れ CPU の色（全面 1 色）と、隠れるときのポーズ。試合の最初の 1 通と、入室・復帰のときに
////   載せる（準備移動の間から、体が色つきで見えるように）
//// - 位置と向きは、小数第 2 位までに丸める（細かい揺れで、送り直さない）
////
//// 観戦ルームには人間の参加者がいないので、全員の位置と色を観戦者に送っても、秘密は漏れない。人間が
//// 参加するルームでは、この通知を作らない（room.gleam が、観戦ルームの箱でだけ呼ぶ / ADR 0021・0035）。

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, OniSelection, Preparation, Reveal, Stage,
}
import rondo_server/games/veryare/hider_cpu.{
  type Placement, Crouching, Lying, Standing,
}
import rondo_server/games/veryare/palette
import rondo_server/room/room_actor.{type PlayerId, PlayerId}

/// 歩いている隠れ CPU のポーズ。
pub const walking_pose = "walking"

/// 鬼のポーズ（鬼の通知と同じ）。
const oni_pose = "standing"

/// ステージに出ている 1 人の、位置・向き・ポーズ。
pub type Actor {
  Actor(player: String, x: Float, z: Float, facing: Float, pose: String)
}

/// 隠れ CPU の、色（#rrggbb）と、隠れるときのポーズ。
pub type Look {
  Look(player: String, pose: String, color: String)
}

/// ステージに出ている全員。elapsed_ms は、いまのフェーズが始まってからの時間（準備移動の歩きに使う）。
pub fn actors(game: Game(PlayerId), elapsed_ms: Int) -> List(Actor) {
  let hiders =
    list.filter_map(game.cpus.hiders, fn(id) { hider(game, id, elapsed_ms) })
  list.append(hiders, oni(game))
}

fn hider(
  game: Game(PlayerId),
  id: PlayerId,
  elapsed_ms: Int,
) -> Result(Actor, Nil) {
  let PlayerId(name) = id
  case game.phase, dict.get(game.cpu_walks, id), dict.get(game.cpu_states, id) {
    OniSelection, _, _ -> Error(Nil)
    Preparation, Ok(walk), _ -> {
      let #(x, z) = hider_cpu.position_at(walk, elapsed_ms)
      case hider_cpu.facing_at(walk, elapsed_ms) {
        Some(facing) -> Ok(actor(name, x, z, facing, walking_pose))
        None ->
          Ok(actor(name, x, z, walk.placement.facing, pose_name(walk.placement)))
      }
    }
    _, _, Ok(placement) ->
      case dict.get(game.positions, id) {
        Ok(game.Position(Stage, x, z)) ->
          Ok(actor(name, x, z, placement.facing, pose_name(placement)))
        _ -> Error(Nil)
      }
    _, _, _ -> Error(Nil)
  }
}

/// 鬼 CPU は、ステージに出ている間（探索の開始から）だけ載る。
fn oni(game: Game(PlayerId)) -> List(Actor) {
  case game.phase, game.oni, game.oni_cpu {
    Exploration, Some(PlayerId(name)), Some(walker)
    | Reveal(_), Some(PlayerId(name)), Some(walker)
    | Ended(_), Some(PlayerId(name)), Some(walker)
    -> {
      let #(x, z) = walker.position
      [actor(name, x, z, walker.facing, oni_pose)]
    }
    _, _, _ -> []
  }
}

fn actor(name: String, x: Float, z: Float, facing: Float, pose: String) {
  Actor(player: name, x: round(x), z: round(z), facing: round(facing), pose:)
}

/// 隠れ CPU の色と、隠れるときのポーズ（参加順）。準備移動の間は、歩く道を決めたときの隠れ場所から、
/// その後は、確定した状態から。
pub fn looks(game: Game(PlayerId)) -> List(Look) {
  list.filter_map(game.cpus.hiders, fn(id) {
    let PlayerId(name) = id
    let placement = case dict.get(game.cpu_states, id) {
      Ok(placement) -> Ok(placement)
      Error(Nil) ->
        dict.get(game.cpu_walks, id)
        |> result_map(fn(walk) { walk.placement })
    }
    result_map(placement, fn(p) {
      Look(player: name, pose: pose_name(p), color: palette.to_hex(p.color))
    })
  })
}

fn result_map(result: Result(a, Nil), f: fn(a) -> b) -> Result(b, Nil) {
  case result {
    Ok(value) -> Ok(f(value))
    Error(Nil) -> Error(Nil)
  }
}

/// 観戦用の通知の電文。looks は、渡したときだけ載せる。
pub fn payload(actors: List(Actor), looks: Option(List(Look))) -> Dynamic {
  let actors =
    list.map(actors, fn(a) {
      dynamic.properties([
        #(dynamic.string("playerId"), dynamic.string(a.player)),
        #(dynamic.string("x"), dynamic.float(a.x)),
        #(dynamic.string("z"), dynamic.float(a.z)),
        #(dynamic.string("facing"), dynamic.float(a.facing)),
        #(dynamic.string("pose"), dynamic.string(a.pose)),
      ])
    })
  let looks = case looks {
    Some(looks) -> [
      #(
        dynamic.string("looks"),
        dynamic.list(
          list.map(looks, fn(l) {
            dynamic.properties([
              #(dynamic.string("playerId"), dynamic.string(l.player)),
              #(dynamic.string("pose"), dynamic.string(l.pose)),
              #(
                dynamic.string("paint"),
                dynamic.properties([
                  #(dynamic.string("kind"), dynamic.string("uniform")),
                  #(dynamic.string("color"), dynamic.string(l.color)),
                ]),
              ),
            ])
          }),
        ),
      ),
    ]
    None -> []
  }
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("spectate")),
    #(dynamic.string("actors"), dynamic.list(actors)),
    ..looks
  ])
}

/// 小数第 2 位までに丸める。
pub fn round(value: Float) -> Float {
  int.to_float(float.round(value *. 100.0)) /. 100.0
}

/// 隠れ場所のポーズの名前（隠れ側の一括配信と同じ）。
pub fn pose_name(placement: Placement) -> String {
  case placement.pose {
    Standing -> "standing"
    Crouching -> "crouching"
    Lying -> "lying"
  }
}
