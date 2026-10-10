/// 移動の規則（issue-29a / ADR 0042）。すべてのステージで共通の、マス目の上の純粋な判定。
///
/// 入力は、マスの大きさ・原点・幅と奥行き・各マスの領域・戸の一覧・開いている襖の集合。
/// 骨格（ADR 0032）は 1 m・原点 (0, 0)・戸はスロットの襖だけ、として写す（of_layout）。
/// 平屋（ADR 0039 / issue-44）は、同じ形にデータを足すだけで使える。
///
/// - 領域のあるマスだけが歩ける
/// - 同じ領域どうしの境は通れ、異なる領域どうしの境は壁で通れない
/// - 戸の一覧にある境は、種類で決まる: 襖は開いているときだけ、いつも開いている戸は通れ、
///   いつも閉じている戸は通れない
/// - 移動（点から点）は、通れない境の手前で止め、境に沿って滑らせる。マスの角をちょうど
///   通るときは、両脇がどちらも通れるときだけ通す（見通しの判定と同じ、安全側の扱い）
///
/// 座標はメートル。マスは、原点からの (x, z) を大きさで割って切り捨てたもの。
import gleam/dict.{type Dict}
import gleam/float
import gleam/int
import gleam/list
import gleam/set.{type Set}
import rondo_server/games/veryare/stage.{type Cell, type Layout, Cell}

/// 戸の種類。
pub type DoorKind {
  /// 開閉できる（開いている襖の集合に入っていれば通れる）。
  Fusuma
  /// いつも開いている（片開き戸・ガラス戸・掃き出し窓・通り抜けなど）。
  AlwaysOpen
  /// いつも閉じている（外へ出る戸など）。
  AlwaysClosed
}

/// 隣り合う2マスの境。向きを問わないよう、edge で作る（小さいマスが a）。
pub type Edge {
  Edge(a: Cell, b: Cell)
}

pub type Grid {
  Grid(
    /// 1マスの大きさ（メートル）。
    cell_size: Float,
    /// 列 0・行 0 のマスの角の座標（x, z）。
    origin: #(Float, Float),
    width: Int,
    depth: Int,
    /// 歩けるマスの領域。ここに無いマスは歩けない。
    regions: Dict(Cell, String),
    doors: Dict(Edge, DoorKind),
  )
}

/// 境を作る。どちら向きに書いても同じ境になる。
pub fn edge(a: Cell, b: Cell) -> Edge {
  case a.x < b.x || { a.x == b.x && a.z <= b.z } {
    True -> Edge(a, b)
    False -> Edge(b, a)
  }
}

/// 襖（開閉できる戸）の境すべて。
pub fn fusuma(grid: Grid) -> Set(Edge) {
  grid.doors
  |> dict.filter(fn(_edge, kind) { kind == Fusuma })
  |> dict.keys
  |> set.from_list
}

pub fn walkable(grid: Grid, cell: Cell) -> Bool {
  dict.has_key(grid.regions, cell)
}

/// 隣り合う2マスの境を越えられるか。open は開いている襖。
pub fn passable(grid: Grid, open: Set(Edge), a: Cell, b: Cell) -> Bool {
  case dict.get(grid.regions, a), dict.get(grid.regions, b) {
    Ok(region_a), Ok(region_b) ->
      case dict.get(grid.doors, edge(a, b)) {
        Ok(Fusuma) -> set.contains(open, edge(a, b))
        Ok(AlwaysOpen) -> True
        Ok(AlwaysClosed) -> False
        Error(Nil) -> region_a == region_b
      }
    _, _ -> False
  }
}

/// 点が入っているマス。
pub fn cell_at(grid: Grid, point: #(Float, Float)) -> Cell {
  let #(u, v) = to_units(grid, point)
  Cell(float.truncate(float.floor(u)), float.truncate(float.floor(v)))
}

/// from から to へ動く。通れない境の手前で止め、境に沿って滑らせる。
/// from が歩けるマスでなければ、動かない。
pub fn step(
  grid: Grid,
  open: Set(Edge),
  from: #(Float, Float),
  to: #(Float, Float),
) -> #(Float, Float) {
  travel(grid, open, from, to, max_slides)
}

/// 滑らせる回数の上限（壁に当たって滑り、もう一度当たって止まるまで）。
const max_slides = 2

/// 止めるときに境から手前へ戻す量（マスの大きさに対する割合）。
const back_off = 0.001

/// 角をちょうど通るとみなす、割合の差。
const same_time = 1.0e-9

const never = 1.0e18

type Blocked {
  OnX
  OnZ
  /// 角で止まった。x_open・z_open は、x の隣・z の隣へ通れるか（滑る向きを決める）。
  OnBoth(x_open: Bool, z_open: Bool)
}

type Walk {
  Arrived
  Stopped(cell: Cell, t: Float, axis: Blocked)
}

fn travel(
  grid: Grid,
  open: Set(Edge),
  from: #(Float, Float),
  to: #(Float, Float),
  slides: Int,
) -> #(Float, Float) {
  let start = cell_at(grid, from)
  case walkable(grid, start) {
    False -> from
    True -> {
      let #(u0, v0) = to_units(grid, from)
      let #(u1, v1) = to_units(grid, to)
      let du = u1 -. u0
      let dv = v1 -. v0
      let walked =
        walk(
          grid,
          open,
          start,
          sign(du),
          sign(dv),
          first_boundary(u0, du, start.x),
          first_boundary(v0, dv, start.z),
          delta(du),
          delta(dv),
        )
      case walked {
        Arrived -> to
        Stopped(cell, t, axis) -> {
          let u = case axis {
            OnX | OnBoth(..) -> inside(cell.x, sign(du))
            OnZ -> u0 +. du *. t
          }
          let v = case axis {
            OnZ | OnBoth(..) -> inside(cell.z, sign(dv))
            OnX -> v0 +. dv *. t
          }
          let stop = from_units(grid, #(u, v))
          slide(grid, open, stop, to, axis, slides)
        }
      }
    }
  }
}

/// 止まった所から、残りの移動のうち、止められた向きを除いた分だけ進む。
fn slide(
  grid: Grid,
  open: Set(Edge),
  stop: #(Float, Float),
  to: #(Float, Float),
  axis: Blocked,
  slides: Int,
) -> #(Float, Float) {
  let rest_x = to.0 -. stop.0
  let rest_z = to.1 -. stop.1
  let target = case axis {
    OnX -> #(stop.0, to.1)
    OnZ -> #(to.0, stop.1)
    // 角で止まったときは、通れる側へ回り込むように滑らせる。どちらも同じなら、残りの
    // 大きい向きへ。
    OnBoth(x_open: True, z_open: False) -> #(to.0, stop.1)
    OnBoth(x_open: False, z_open: True) -> #(stop.0, to.1)
    OnBoth(..) ->
      case float.absolute_value(rest_x) >=. float.absolute_value(rest_z) {
        True -> #(to.0, stop.1)
        False -> #(stop.0, to.1)
      }
  }
  case slides <= 0 || target == stop {
    True -> stop
    False -> travel(grid, open, stop, target, slides - 1)
  }
}

/// 線分をマスごとに辿る（グリッドの走査）。t は線分の長さを 1 とした割合。
fn walk(
  grid: Grid,
  open: Set(Edge),
  cell: Cell,
  step_x: Int,
  step_z: Int,
  t_x: Float,
  t_z: Float,
  delta_x: Float,
  delta_z: Float,
) -> Walk {
  let next = fn(next_cell, next_x, next_z) {
    walk(
      grid,
      open,
      next_cell,
      step_x,
      step_z,
      next_x,
      next_z,
      delta_x,
      delta_z,
    )
  }
  case t_x >=. 1.0 && t_z >=. 1.0 {
    True -> Arrived
    False ->
      case float.absolute_value(t_x -. t_z) <. same_time {
        // 角をちょうど通る。両脇の道筋がどちらも通れるときだけ通す。
        True -> {
          let side_x = Cell(cell.x + step_x, cell.z)
          let side_z = Cell(cell.x, cell.z + step_z)
          let corner = Cell(cell.x + step_x, cell.z + step_z)
          let x_open = passable(grid, open, cell, side_x)
          let z_open = passable(grid, open, cell, side_z)
          case
            x_open
            && passable(grid, open, side_x, corner)
            && z_open
            && passable(grid, open, side_z, corner)
          {
            True -> next(corner, t_x +. delta_x, t_z +. delta_z)
            False -> Stopped(cell, t_x, OnBoth(x_open:, z_open:))
          }
        }
        False ->
          case t_x <. t_z {
            True -> {
              let neighbor = Cell(cell.x + step_x, cell.z)
              case passable(grid, open, cell, neighbor) {
                True -> next(neighbor, t_x +. delta_x, t_z)
                False -> Stopped(cell, t_x, OnX)
              }
            }
            False -> {
              let neighbor = Cell(cell.x, cell.z + step_z)
              case passable(grid, open, cell, neighbor) {
                True -> next(neighbor, t_x, t_z +. delta_z)
                False -> Stopped(cell, t_z, OnZ)
              }
            }
          }
      }
  }
}

/// 止められた境の、マスの内側すぐの位置（マスの単位）。
fn inside(index: Int, direction: Int) -> Float {
  let base = int.to_float(index)
  case direction > 0 {
    True -> base +. 1.0 -. back_off
    False -> base +. back_off
  }
}

fn to_units(grid: Grid, point: #(Float, Float)) -> #(Float, Float) {
  #(
    { point.0 -. grid.origin.0 } /. grid.cell_size,
    { point.1 -. grid.origin.1 } /. grid.cell_size,
  )
}

fn from_units(grid: Grid, units: #(Float, Float)) -> #(Float, Float) {
  #(
    grid.origin.0 +. units.0 *. grid.cell_size,
    grid.origin.1 +. units.1 *. grid.cell_size,
  )
}

fn sign(value: Float) -> Int {
  case value >. 0.0, value <. 0.0 {
    True, _ -> 1
    _, True -> -1
    _, _ -> 0
  }
}

fn delta(d: Float) -> Float {
  case d == 0.0 {
    True -> never
    False -> 1.0 /. float.absolute_value(d)
  }
}

/// 線分の向きに進んで、最初にマスの境を越えるまでの割合。
fn first_boundary(start: Float, d: Float, index: Int) -> Float {
  case sign(d) {
    1 -> { int.to_float(index + 1) -. start } /. d
    -1 -> { int.to_float(index) -. start } /. d
    _ -> never
  }
}

/// 点から境（2マスが接する辺の線分）までの距離（メートル）。襖を開ける距離の判定に使う
/// （issue-29b）。
pub fn distance_to_edge(
  grid: Grid,
  edge: Edge,
  point: #(Float, Float),
) -> Float {
  let Edge(a, b) = edge
  // 辺の両端（マスの単位）。a と b は隣り合う。
  let #(start, end) = case a.x == b.x {
    // 上下に並ぶ: z = 大きい方の z の線で、x は a.x〜a.x + 1。
    True -> {
      let z = int.to_float(int.max(a.z, b.z))
      #(#(int.to_float(a.x), z), #(int.to_float(a.x) +. 1.0, z))
    }
    // 左右に並ぶ: x = 大きい方の x の線で、z は a.z〜a.z + 1。
    False -> {
      let x = int.to_float(int.max(a.x, b.x))
      #(#(x, int.to_float(a.z)), #(x, int.to_float(a.z) +. 1.0))
    }
  }
  let s = from_units(grid, start)
  let e = from_units(grid, end)
  let dx = e.0 -. s.0
  let dz = e.1 -. s.1
  let length2 = dx *. dx +. dz *. dz
  let t =
    float.clamp(
      { { point.0 -. s.0 } *. dx +. { point.1 -. s.1 } *. dz } /. length2,
      0.0,
      1.0,
    )
  let nx = s.0 +. dx *. t -. point.0
  let nz = s.1 +. dz *. t -. point.1
  let assert Ok(d) = float.square_root(nx *. nx +. nz *. nz)
  d
}

// --- 骨格を写す -------------------------------------------------------------------

/// 骨格（ADR 0032）を移動の規則の入力に写す。1マス 1 m、原点 (0, 0)。廊下・縁側・玄関は
/// ひと続きの領域 "open"、部屋が割り当てられたスロットは、そのスロットの ID の領域。
/// 空きのスロットは歩けない。戸は、割り当てられたスロットの襖だけ。
pub fn of_layout(layout: Layout) -> Grid {
  let skeleton = layout.skeleton
  let assigned =
    list.filter(skeleton.slots, fn(slot) { dict.has_key(layout.rooms, slot.id) })
  let open = list.map(skeleton.walkable, fn(cell) { #(cell, open_region) })
  let rooms =
    list.flat_map(assigned, fn(slot) {
      list.map(slot.cells, fn(cell) { #(cell, slot.id) })
    })
  let doors =
    assigned
    |> list.flat_map(fn(slot) { slot.doors })
    |> list.map(fn(door) { #(edge(door.corridor, door.slot), Fusuma) })
  Grid(
    cell_size: 1.0,
    origin: #(0.0, 0.0),
    width: skeleton.width,
    depth: skeleton.depth,
    regions: dict.from_list(list.append(open, rooms)),
    doors: dict.from_list(doors),
  )
}

/// 骨格の、廊下・縁側・玄関の領域の名前。
pub const open_region = "open"
