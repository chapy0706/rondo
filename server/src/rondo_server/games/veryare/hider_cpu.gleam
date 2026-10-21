/// 隠れ CPU（ADR 0038 / issue-33）。純粋な関数で、乱数は種を引数に取る。
///
/// 準備移動の終わりに、部屋が割り当てられたスロットのマスから、すでにいる隠れ側とも
/// CPU どうしとも被らない（ADR 0026 の球が重ならない）マスを選び、その中心に置く。
/// ポーズと向きもランダムに選び、ペイントはその部屋の代表色で全面を1色に塗る。
///
/// 観戦ルーム（issue-67）では、準備移動の始めに隠れ場所を決め、玄関からそこまでの道（鬼 CPU の
/// 幅優先探索）を、人と同じ速さで歩く（plan_walks・position_at）。準備移動の時間の内に着ける場所だけを
/// 選ぶ。人間の対戦の CPU は、これまでどおり、準備移動の終わりに直接置く（place）。
import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/palette.{type Rgb}
import rondo_server/games/veryare/sight
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
  place_among(candidates_of(layout), occupied, count, seed)
}

/// 置ける候補（部屋が割り当てられたスロットのマスの中心と、その部屋）。
fn candidates_of(layout: Layout) -> List(#(Float, Float, stage.RoomType)) {
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
}

/// 候補を種で並べ替え、誰とも被らないマスを count 個まで選び、向き・ポーズ・色を決める。
fn place_among(
  candidates: List(#(Float, Float, stage.RoomType)),
  occupied: List(#(Float, Float)),
  count: Int,
  seed: Int,
) -> List(Placement) {
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

// --- 観戦ルームの歩き（issue-67） ---------------------------------------------------

/// 歩く速さ（メートル/秒）。準備移動の時間を決めた、人の速さと同じ（skeleton_check）。
pub const walk_speed = 4.5

/// 準備移動の終わりより、これだけ前に着く（ミリ秒）。
const margin_ms = 2000

/// 隠れ CPU 1 体の歩き。path は、玄関（出発点）から隠れ場所（placement の位置）までの点の並び
/// （2 つ目からは、マスの中心を 1 マスずつ）。
pub type Walk {
  Walk(placement: Placement, path: List(#(Float, Float)))
}

/// 準備移動の時間 preparation_ms のうち、歩いてよい時間（余裕の 2 秒を引く。0 より小さくしない）。
pub fn reach_ms(preparation_ms: Int) -> Int {
  int.max(0, preparation_ms - margin_ms)
}

/// count 体ぶんの隠れ場所と、玄関からの道を決める。着くまでの時間が reach 以内の場所だけを候補にし、
/// 候補の選び方（並べ替え・被らない・向き・ポーズ・色）は place と同じ。置ける場所が足りなければ、
/// 置けた分だけを返す。
pub fn plan_walks(
  layout: Layout,
  count: Int,
  seed: Int,
  reach: Int,
) -> List(Walk) {
  let map = sight.map_of(layout)
  let spawn = layout.skeleton.spawn
  let from = sight.cell_of(spawn)
  let #(_, parents) = oni_cpu.search(map, from)
  let path_to = fn(x: Float, z: Float) {
    let cells = oni_cpu.trace(parents, from, sight.cell_of(#(x, z)), [])
    [
      spawn,
      ..list.map(cells, fn(cell) {
        #(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5)
      })
    ]
    |> ending_at(#(x, z))
  }
  let reachable =
    candidates_of(layout)
    |> list.filter(fn(spot) {
      let #(x, z, _) = spot
      let to = sight.cell_of(#(x, z))
      let path = path_to(x, z)
      // 玄関のマスでなければ、道が見つかったこと（trace が空でない）を確かめる。
      { to == from || list.length(path) >= 2 } && duration_ms(path) <= reach
    })
  place_among(reachable, [], count, seed)
  |> list.map(fn(placement) {
    Walk(placement:, path: path_to(placement.x, placement.z))
  })
}

/// 道の最後を、隠れ場所の位置にそろえる（玄関のマスに置くときは、玄関から 1 歩で着く）。
fn ending_at(
  path: List(#(Float, Float)),
  goal: #(Float, Float),
) -> List(#(Float, Float)) {
  case list.last(path) {
    Ok(last) if last == goal -> path
    _ -> list.append(path, [goal])
  }
}

/// 玄関から隠れ場所に着くまでの時間（ミリ秒。切り上げ）。
pub fn arrival_ms(walk: Walk) -> Int {
  duration_ms(walk.path)
}

fn duration_ms(path: List(#(Float, Float))) -> Int {
  float.truncate(float.ceiling(length(path) /. walk_speed *. 1000.0))
}

fn length(path: List(#(Float, Float))) -> Float {
  list.window_by_2(path)
  |> list.fold(0.0, fn(total, pair) { total +. distance(pair.0, pair.1) })
}

/// 歩き始めから elapsed ミリ秒の位置。道の上を walk_speed で進み、着いたら隠れ場所にとどまる。
pub fn position_at(walk: Walk, elapsed: Int) -> #(Float, Float) {
  let budget = walk_speed *. int.to_float(int.max(elapsed, 0)) /. 1000.0
  along(walk.path, budget)
}

/// 歩き始めから elapsed ミリ秒の、進んでいる向き（ラジアン。x 軸から z 軸の向きへ回る / issue-67 の
/// 観戦用の通知）。着いた後と、長さの無い道（隠れ場所が玄関）は None（隠れ場所の向きを使う）。
pub fn facing_at(walk: Walk, elapsed: Int) -> Option(Float) {
  case elapsed >= arrival_ms(walk) {
    True -> None
    False ->
      heading(
        walk.path,
        walk_speed *. int.to_float(int.max(elapsed, 0)) /. 1000.0,
      )
  }
}

fn heading(path: List(#(Float, Float)), budget: Float) -> Option(Float) {
  case path {
    [a, b, ..rest] ->
      case budget <. distance(a, b) {
        True -> Some(oni_cpu.face(a, b))
        False -> heading([b, ..rest], budget -. distance(a, b))
      }
    _ -> None
  }
}

fn along(path: List(#(Float, Float)), budget: Float) -> #(Float, Float) {
  case path {
    [] -> #(0.0, 0.0)
    [only] -> only
    [a, b, ..rest] -> {
      let d = distance(a, b)
      case budget <. d {
        True -> {
          let t = budget /. d
          #(a.0 +. { b.0 -. a.0 } *. t, a.1 +. { b.1 -. a.1 } *. t)
        }
        False -> along([b, ..rest], budget -. d)
      }
    }
  }
}

fn distance(a: #(Float, Float), b: #(Float, Float)) -> Float {
  let dx = a.0 -. b.0
  let dz = a.1 -. b.1
  case float.square_root(dx *. dx +. dz *. dz) {
    Ok(d) -> d
    Error(Nil) -> 0.0
  }
}
