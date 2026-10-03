/// 鬼の見通し（ADR 0038 / issue-34）。マス目の上の純粋な判定。
///
/// 骨格のマスを「領域」に分ける。廊下・縁側・玄関はひと続きの開けた場所（Open）、
/// 部屋が割り当てられたスロットはそれぞれ1つの部屋（Room）。それ以外（壁・庭・空きの
/// スロット）は通れず見通せない。隣り合う2マスの境は、同じ領域なら通し、廊下と部屋の
/// 境は、そこにある襖が開いているときだけ通す。部屋どうしの境は常に壁。
///
/// 見通しは、2点を結ぶ線分が通るマスを順に辿り（グリッドの走査）、越える境がすべて
/// 通せるかで決める。線がマスの角をちょうど通るときは、角の両脇の道筋がどちらも通せる
/// 場合だけ通す（壁の角越しに覗けないよう、安全側に倒す / ADR 0028）。
import gleam/dict.{type Dict}
import gleam/float
import gleam/int
import gleam/list
import gleam/set.{type Set}
import rondo_server/games/veryare/stage.{
  type Cell, type Door, type Layout, Cell, Door,
}

/// マスが属する領域。
pub type Region {
  Open
  Room(slot: String)
}

/// 見通しの判定に使う、骨格の領域と襖。
pub opaque type Map {
  Map(regions: Dict(Cell, Region), doors: Set(Door))
}

/// 視野。fov は視野角（ラジアン、左右合わせて）、range は視距離（メートル）。
pub type View {
  View(fov: Float, range: Float)
}

/// ステージから見通しの地図を作る。部屋が割り当てられていないスロットは壁として扱う。
pub fn map_of(layout: Layout) -> Map {
  let skeleton = layout.skeleton
  let open = list.map(skeleton.walkable, fn(cell) { #(cell, Open) })
  let rooms =
    skeleton.slots
    |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
    |> list.flat_map(fn(slot) {
      list.map(slot.cells, fn(cell) { #(cell, Room(slot.id)) })
    })
  let doors =
    skeleton.slots
    |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
    |> list.flat_map(fn(slot) { slot.doors })
  Map(
    regions: dict.from_list(list.append(open, rooms)),
    doors: set.from_list(doors),
  )
}

/// マスの領域。壁なら Error。
pub fn region_at(map: Map, cell: Cell) -> Result(Region, Nil) {
  dict.get(map.regions, cell)
}

/// 地図にある襖すべて。
pub fn doors(map: Map) -> List(Door) {
  set.to_list(map.doors)
}

/// 隣り合う2マスの境を越えられるか（見通し・移動とも）。
/// open_doors に入っている襖だけが開いている。
pub fn passable(map: Map, open_doors: Set(Door), a: Cell, b: Cell) -> Bool {
  case region_at(map, a), region_at(map, b) {
    Ok(ra), Ok(rb) if ra == rb -> True
    Ok(_), Ok(_) -> {
      let door = door_between(map, a, b)
      case door {
        Ok(d) -> set.contains(open_doors, d)
        Error(Nil) -> False
      }
    }
    _, _ -> False
  }
}

/// 2マスの境にある襖（向きは問わない）。
pub fn door_between(map: Map, a: Cell, b: Cell) -> Result(Door, Nil) {
  case
    set.contains(map.doors, Door(a, b)),
    set.contains(map.doors, Door(b, a))
  {
    True, _ -> Ok(Door(a, b))
    _, True -> Ok(Door(b, a))
    _, _ -> Error(Nil)
  }
}

/// 2点（メートル）の間に、遮るものが無いか。
pub fn line_of_sight(
  map: Map,
  open_doors: Set(Door),
  from: #(Float, Float),
  to: #(Float, Float),
) -> Bool {
  let #(x0, z0) = from
  let #(x1, z1) = to
  let start = cell_of(from)
  let goal = cell_of(to)
  let dx = x1 -. x0
  let dz = z1 -. z0
  let step_x = sign(dx)
  let step_z = sign(dz)
  let t_delta_x = delta(dx)
  let t_delta_z = delta(dz)
  let t_max_x = first_boundary(x0, dx, start.x)
  let t_max_z = first_boundary(z0, dz, start.z)
  case region_at(map, start), region_at(map, goal) {
    Ok(_), Ok(_) ->
      walk(
        map,
        open_doors,
        start,
        goal,
        step_x,
        step_z,
        t_max_x,
        t_max_z,
        t_delta_x,
        t_delta_z,
        // 走査の上限（地図の大きさに対して十分大きい）。
        1000,
      )
    _, _ -> False
  }
}

/// 向き facing（ラジアン。x 軸から z 軸の向きへ回る）を見ている鬼が、target を見えるか。
/// 視距離の内側、視野角の内側で、遮るものが無いこと。
pub fn can_see(
  map: Map,
  open_doors: Set(Door),
  from: #(Float, Float),
  facing: Float,
  view: View,
  target: #(Float, Float),
) -> Bool {
  let dx = target.0 -. from.0
  let dz = target.1 -. from.1
  let distance = sqrt(dx *. dx +. dz *. dz)
  distance <=. view.range
  && within_fov(facing, view.fov, dx, dz, distance)
  && line_of_sight(map, open_doors, from, target)
}

fn within_fov(
  facing: Float,
  fov: Float,
  dx: Float,
  dz: Float,
  distance: Float,
) -> Bool {
  case distance <. 0.000001 {
    True -> True
    False -> {
      let diff = normalize_angle(atan2(dz, dx) -. facing)
      float.absolute_value(diff) <=. fov /. 2.0
    }
  }
}

/// -π〜π に収める。
pub fn normalize_angle(angle: Float) -> Float {
  let two_pi = 2.0 *. pi
  let wrapped = angle -. two_pi *. floor({ angle +. pi } /. two_pi)
  wrapped
}

// --- グリッドの走査 -----------------------------------------------------------

fn walk(
  map: Map,
  open_doors: Set(Door),
  cell: Cell,
  goal: Cell,
  step_x: Int,
  step_z: Int,
  t_max_x: Float,
  t_max_z: Float,
  t_delta_x: Float,
  t_delta_z: Float,
  budget: Int,
) -> Bool {
  case cell == goal, budget <= 0 {
    True, _ -> True
    _, True -> False
    False, False -> {
      let epsilon = 0.000000001
      let next_x = Cell(cell.x + step_x, cell.z)
      let next_z = Cell(cell.x, cell.z + step_z)
      case t_max_x <. t_max_z -. epsilon, t_max_z <. t_max_x -. epsilon {
        True, _ ->
          passable(map, open_doors, cell, next_x)
          && walk(
            map,
            open_doors,
            next_x,
            goal,
            step_x,
            step_z,
            t_max_x +. t_delta_x,
            t_max_z,
            t_delta_x,
            t_delta_z,
            budget - 1,
          )
        _, True ->
          passable(map, open_doors, cell, next_z)
          && walk(
            map,
            open_doors,
            next_z,
            goal,
            step_x,
            step_z,
            t_max_x,
            t_max_z +. t_delta_z,
            t_delta_x,
            t_delta_z,
            budget - 1,
          )
        // 角をちょうど通る。両脇の道筋がどちらも通せるときだけ斜めに進む。
        False, False -> {
          let diagonal = Cell(cell.x + step_x, cell.z + step_z)
          passable(map, open_doors, cell, next_x)
          && passable(map, open_doors, next_x, diagonal)
          && passable(map, open_doors, cell, next_z)
          && passable(map, open_doors, next_z, diagonal)
          && walk(
            map,
            open_doors,
            diagonal,
            goal,
            step_x,
            step_z,
            t_max_x +. t_delta_x,
            t_max_z +. t_delta_z,
            t_delta_x,
            t_delta_z,
            budget - 1,
          )
        }
      }
    }
  }
}

/// 点が入っているマス。
pub fn cell_of(point: #(Float, Float)) -> Cell {
  Cell(float.truncate(floor(point.0)), float.truncate(floor(point.1)))
}

fn sign(value: Float) -> Int {
  case value >. 0.0, value <. 0.0 {
    True, _ -> 1
    _, True -> -1
    _, _ -> 0
  }
}

const never = 1.0e18

fn delta(d: Float) -> Float {
  case d == 0.0 {
    True -> never
    False -> 1.0 /. float.absolute_value(d)
  }
}

/// 線分の向きに進んで、最初にマスの境を越えるまでの割合（0〜1 を線分の長さとする）。
fn first_boundary(origin: Float, d: Float, cell: Int) -> Float {
  case d >. 0.0, d <. 0.0 {
    True, _ -> { int.to_float(cell + 1) -. origin } /. d
    _, True -> { int.to_float(cell) -. origin } /. d
    _, _ -> never
  }
}

const pi = 3.141592653589793

@external(erlang, "math", "floor")
fn floor(x: Float) -> Float

@external(erlang, "math", "atan2")
fn atan2(y: Float, x: Float) -> Float

@external(erlang, "math", "sqrt")
fn sqrt(x: Float) -> Float
