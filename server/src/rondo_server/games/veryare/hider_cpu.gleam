/// 隠れ CPU（ADR 0038 / issue-33）。純粋な関数で、乱数は種を引数に取る。
///
/// 準備移動の終わりに、部屋が割り当てられたスロットのマスから、すでにいる隠れ側とも
/// CPU どうしとも被らない（ADR 0026 の球が重ならない）マスを選び、その中心に置く。
/// ポーズと向きもランダムに選び、ペイントはその部屋の代表色で全面を1色に塗る。
import gleam/dict
import gleam/int
import gleam/list
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/palette.{type Rgb}
import rondo_server/games/veryare/stage.{type Layout}

/// ポーズ（仮の3種類 / issue-33）。見た目と選ぶ画面は、モデルと一緒に後の issue で作る。
pub type Pose {
  Standing
  Crouching
  Lying
}

/// 隠れ CPU 1体の確定した状態。座標は骨格のマス座標（メートル）。
pub type Placement {
  Placement(x: Float, z: Float, facing: Float, pose: Pose, color: Rgb)
}

const pi = 3.141592653589793

/// count 体を置く。occupied はすでにいる隠れ側の位置（x, z）。置ける場所が足りなければ、
/// 置けた分だけを返す。
pub fn place(
  layout: Layout,
  occupied: List(#(Float, Float)),
  count: Int,
  seed: Int,
) -> List(Placement) {
  let candidates =
    layout.skeleton.slots
    |> list.flat_map(fn(slot) {
      case dict.get(layout.rooms, slot.id) {
        Ok(room) ->
          list.map(slot.cells, fn(cell) {
            #(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5, room)
          })
        Error(Nil) -> []
      }
    })
  let #(shuffled, seed) = stage.shuffle(candidates, stage.normalize(seed))
  let chosen = choose(shuffled, occupied, count, [])

  let #(placed, _seed) =
    list.fold(chosen, #([], seed), fn(acc, spot) {
      let #(placed, seed) = acc
      let #(x, z, room) = spot
      let #(degrees, seed) = stage.draw(seed, 360)
      let #(pose, seed) = stage.draw(seed, 3)
      let placement =
        Placement(
          x:,
          z:,
          facing: int.to_float(degrees) *. pi /. 180.0,
          pose: case pose {
            0 -> Standing
            1 -> Crouching
            _ -> Lying
          },
          color: palette.room_color(room),
        )
      #([placement, ..placed], seed)
    })
  list.reverse(placed)
}

/// 並べた候補を前から見て、誰とも被らないマスを count 個まで選ぶ。
fn choose(
  candidates: List(#(Float, Float, a)),
  occupied: List(#(Float, Float)),
  count: Int,
  chosen: List(#(Float, Float, a)),
) -> List(#(Float, Float, a)) {
  case candidates, list.length(chosen) >= count {
    _, True | [], _ -> list.reverse(chosen)
    [spot, ..rest], False -> {
      let #(x, z, _) = spot
      case clear(x, z, occupied) {
        True -> choose(rest, [#(x, z), ..occupied], count, [spot, ..chosen])
        False -> choose(rest, occupied, count, chosen)
      }
    }
  }
}

/// 誰の球とも重ならないか（ちょうど接するのは重なりではない / ADR 0026）。
fn clear(x: Float, z: Float, occupied: List(#(Float, Float))) -> Bool {
  let diameter = overlap.radius *. 2.0
  list.all(occupied, fn(other) {
    let dx = x -. other.0
    let dz = z -. other.1
    dx *. dx +. dz *. dz >=. diameter *. diameter
  })
}
