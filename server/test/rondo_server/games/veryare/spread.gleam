//// テストの補助（issue-29a）: 玄関に全員が現れる（ADR 0032）ので、隠れ側を別々の場所へ動かす。
////
//// 玄関のマスから上下左右へ、同じ領域のまま一直線にたどれるマスを近い順に並べ、互いに
//// 被らない（球の直径 0.6 m より余裕を持たせて 0.8 m 以上離れた）位置を選ぶ。一直線なので、
//// 玄関から移動の規則で動かせば、そのまま着く。bots/ の同じ名前の関数と同じ選び方。

import gleam/float
import gleam/int
import gleam/list
import gleam/set
import rondo_server/games/veryare/game.{type Game}
import rondo_server/games/veryare/grid.{type Grid}
import rondo_server/games/veryare/stage.{type Cell, Cell}

/// 互いの距離の下限（メートル）。被り判定の直径 0.6 m に余裕を足す。
const min_gap = 0.8

/// from から一直線にたどれる、別々の位置を count 個（max_distance メートル以内）。
pub fn spots(
  grid: Grid,
  from: #(Float, Float),
  count: Int,
  max_distance: Float,
) -> List(#(Float, Float)) {
  let start = grid.cell_at(grid, from)
  let directions = [#(0, -1), #(1, 0), #(-1, 0), #(0, 1)]
  let lines =
    list.map(directions, fn(d) { line(grid, start, d, []) |> list.reverse })
  let longest = list.fold(lines, 0, fn(n, l) { int.max(n, list.length(l)) })
  // 近い順（1マス目を4方向、2マス目を4方向…）に並べる。
  let ordered =
    indices(longest)
    |> list.flat_map(fn(k) {
      list.flat_map(list.zip(directions, lines), fn(pair) {
        let #(d, cells) = pair
        case list.drop(cells, k) |> list.first {
          Ok(cell) -> [point(grid, from, d, cell)]
          Error(Nil) -> []
        }
      })
    })
  ordered
  |> list.filter(fn(p) { distance(from, p) <=. max_distance })
  |> list.fold([], fn(chosen, p) {
    case
      distance(from, p) >=. min_gap
      && list.all(chosen, fn(q) { distance(p, q) >=. min_gap })
    {
      True -> list.append(chosen, [p])
      False -> chosen
    }
  })
  |> list.take(count)
}

/// 準備移動の間に、ids の隠れ側を別々の位置へ動かす（game.move を通す）。
pub fn hiders(game: Game(String), ids: List(String)) -> Game(String) {
  let targets =
    spots(game.grid, game.layout.skeleton.spawn, list.length(ids), 7.0)
  list.zip(ids, targets)
  |> list.fold(game, fn(g, pair) {
    let #(id, #(x, z)) = pair
    game.move(g, id, x, z)
  })
}

fn indices(n: Int) -> List(Int) {
  case n <= 0 {
    True -> []
    False -> list.append(indices(n - 1), [n - 1])
  }
}

/// 同じ領域のまま、d の向きにたどれるマス（遠い順）。
fn line(grid: Grid, cell: Cell, d: #(Int, Int), acc: List(Cell)) -> List(Cell) {
  let next = Cell(cell.x + d.0, cell.z + d.1)
  case grid.passable(grid, set.new(), cell, next) {
    True -> line(grid, next, d, [next, ..acc])
    False -> acc
  }
}

/// 一直線に着ける位置: 動く向きのマスの中心と、もう一方は from のまま。
fn point(
  grid: Grid,
  from: #(Float, Float),
  d: #(Int, Int),
  cell: Cell,
) -> #(Float, Float) {
  let center_x =
    grid.origin.0 +. { int.to_float(cell.x) +. 0.5 } *. grid.cell_size
  let center_z =
    grid.origin.1 +. { int.to_float(cell.z) +. 0.5 } *. grid.cell_size
  case d.0 == 0 {
    True -> #(from.0, center_z)
    False -> #(center_x, from.1)
  }
}

fn distance(a: #(Float, Float), b: #(Float, Float)) -> Float {
  let dx = a.0 -. b.0
  let dz = a.1 -. b.1
  let assert Ok(d) = float.square_root(dx *. dx +. dz *. dz)
  d
}
