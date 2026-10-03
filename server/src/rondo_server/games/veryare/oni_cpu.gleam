/// 鬼 CPU（ADR 0038 / issue-34）。純粋な関数で、乱数は種を状態に持って引き継ぐ。
///
/// 探索フェーズの間、0.5秒ごとに step を1回呼ぶ。1回の step で次をする。
/// 1. 移動: 歩く速さぶんの予算でマスを進む。玄関から出て、部屋の襖を巡る。次の部屋は、
///    近い未訪問の部屋を基本に、ときどきランダムに選び（wander）、飛ばし（skip）、
///    訪ねた部屋をもう一度選ぶ（revisit）。襖の前では、まず開けてから通る（1歩使う）。
///    開けた襖は開けっぱなし（ADR 0033）。部屋に入ったら少しの間、部屋の中を見回す
/// 2. 発見: 視界（視野角・視距離・見通し / sight）に入った隠れ側ごとに乱数を引く。
///    確率は近いほど高く、溶け込んでいるほど低く、下限より下がらない
///
/// 経路は、通れる境（同じ領域か、襖のある境）だけを辿る幅優先探索で求める。
import gleam/dict.{type Dict}
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/set.{type Set}
import rondo_server/games/veryare/palette.{type Rgb}
import rondo_server/games/veryare/sight.{type Map, type View, View}
import rondo_server/games/veryare/stage.{type Cell, type Door, type Layout, Cell}

/// 強さのプリセット（ルーム作成時に選ぶ）。
pub type Strength {
  Weak
  Normal
  Strong
}

/// 強さを決めるパラメータ。角度はラジアン、長さはメートル、速さは m/秒。
pub type Params {
  Params(
    speed: Float,
    fov_min: Float,
    fov_max: Float,
    range_min: Float,
    range_max: Float,
    /// 発見確率の最大（目の前で、まったく溶け込んでいないとき）。
    base_chance: Float,
    /// 発見確率の下限（0 にしない）。
    min_chance: Float,
    /// 溶け込み度が発見確率を下げる強さ（0〜1）。
    blend_weight: Float,
    /// 次の部屋を、近い順ではなくランダムに選ぶ確率（探索の粗さ）。
    wander: Float,
    /// 選んだ部屋を訪ねずに飛ばす確率。
    skip: Float,
    /// 訪ねた部屋をもう一度選ぶ確率。
    revisit: Float,
  )
}

const pi = 3.141592653589793

/// 1回の step の長さ（秒）。
pub const step_seconds = 0.5

/// 部屋に入ってから見回す step の数。
const look_steps = 2

/// 強さごとのパラメータ。シミュレーション（make simulate）の集計を見て調整する。
pub fn params(strength: Strength) -> Params {
  case strength {
    Weak ->
      Params(
        speed: 1.6,
        fov_min: degrees(70.0),
        fov_max: degrees(90.0),
        range_min: 4.0,
        range_max: 6.0,
        base_chance: 0.7,
        min_chance: 0.25,
        blend_weight: 0.5,
        wander: 0.45,
        skip: 0.12,
        revisit: 0.12,
      )
    Normal ->
      Params(
        speed: 2.0,
        fov_min: degrees(80.0),
        fov_max: degrees(100.0),
        range_min: 5.0,
        range_max: 8.0,
        base_chance: 0.85,
        min_chance: 0.35,
        blend_weight: 0.4,
        wander: 0.25,
        skip: 0.06,
        revisit: 0.06,
      )
    Strong ->
      Params(
        speed: 2.4,
        fov_min: degrees(90.0),
        fov_max: degrees(120.0),
        range_min: 6.0,
        range_max: 10.0,
        base_chance: 1.0,
        min_chance: 0.5,
        blend_weight: 0.3,
        wander: 0.08,
        skip: 0.02,
        revisit: 0.02,
      )
  }
}

fn degrees(value: Float) -> Float {
  value *. pi /. 180.0
}

/// 鬼 CPU の状態。
pub type OniCpu {
  OniCpu(
    params: Params,
    view: View,
    seed: Int,
    /// 位置（メートル）と、いるマス。
    position: #(Float, Float),
    cell: Cell,
    /// 向き（ラジアン。x 軸から z 軸の向きへ回る）。
    facing: Float,
    open_doors: Set(Door),
    /// これから歩くマス。
    route: List(Cell),
    /// 向かっている部屋（スロットの ID）。
    goal: Option(String),
    visited: Set(String),
    /// 歩く予算（マス）。速さぶん増え、1マス進むか襖を1つ開けるごとに1減る。
    budget: Float,
    /// 部屋の中を見回す残りの step。
    looking: Int,
    /// 直前の step で通ったマス（出発したマスは含めない）。
    trail: List(Cell),
  )
}

/// 隠れ側。color はペイントの平均色。
pub type Hider(id) {
  Hider(id: id, x: Float, z: Float, color: Rgb)
}

/// 強さのプリセットで、玄関から出発する。
pub fn start(layout: Layout, strength: Strength, seed: Int) -> OniCpu {
  start_with(layout, params(strength), seed)
}

/// パラメータを直接渡して出発する（テスト・調整用）。視野角と視距離は範囲から乱数で決める。
pub fn start_with(layout: Layout, params: Params, seed: Int) -> OniCpu {
  let seed = stage.normalize(seed)
  let #(a, seed) = roll(seed)
  let #(b, seed) = roll(seed)
  let spawn = layout.skeleton.spawn
  OniCpu(
    params:,
    view: View(
      fov: params.fov_min +. a *. { params.fov_max -. params.fov_min },
      range: params.range_min +. b *. { params.range_max -. params.range_min },
    ),
    seed:,
    position: spawn,
    cell: sight.cell_of(spawn),
    // 玄関は手前（z が大きい側）にあるので、奥（z が減る向き）を向いて出発する。
    facing: 0.0 -. pi /. 2.0,
    open_doors: set.new(),
    route: [],
    goal: None,
    visited: set.new(),
    budget: 0.0,
    looking: 0,
    trail: [],
  )
}

/// 0.5秒ぶん進める。戻り値は、次の状態・見つけた隠れ側・視界に入っていた隠れ側。
/// 視界に入っていた隠れ側は、見逃しポイント（ADR 0036 / issue-32）の判定にも使う。
pub fn step(
  cpu: OniCpu,
  map: Map,
  layout: Layout,
  hiders: List(Hider(id)),
) -> #(OniCpu, List(id), List(id)) {
  let budget = float.min(cpu.budget +. cpu.params.speed *. step_seconds, 2.0)
  let moved = walk(OniCpu(..cpu, budget:, trail: []), map, layout, 8)
  let moved = OniCpu(..moved, trail: list.reverse(moved.trail))
  let #(found, seen, seed) = detect(moved, map, layout, hiders)
  #(OniCpu(..moved, seed:), found, seen)
}

/// 発見確率。近いほど高く、溶け込んでいるほど（blend が 1 に近いほど）低い。下限あり。
pub fn find_chance(
  params: Params,
  view: View,
  distance: Float,
  blend: Float,
) -> Float {
  let closeness = float.clamp(1.0 -. distance /. view.range, 0.0, 1.0)
  let visibility = 1.0 -. params.blend_weight *. float.clamp(blend, 0.0, 1.0)
  float.max(params.min_chance, params.base_chance *. closeness *. visibility)
}

// --- 移動 ----------------------------------------------------------------

/// 予算の続く限り進む。guard は1回の step での堂々巡りを防ぐ上限。
fn walk(cpu: OniCpu, map: Map, layout: Layout, guard: Int) -> OniCpu {
  case guard <= 0 {
    True -> cpu
    False ->
      case cpu.route {
        [] ->
          case cpu.looking > 0 {
            // 見回している間は進まない。
            True -> OniCpu(..cpu, looking: cpu.looking - 1, budget: 0.0)
            False -> {
              let chosen = choose_goal(cpu, map, layout)
              case chosen.route {
                [] -> OniCpu(..chosen, budget: 0.0)
                _ -> walk(chosen, map, layout, guard - 1)
              }
            }
          }
        [next, ..rest] ->
          // 小数の誤差で1歩を取りこぼさないよう、わずかに余裕を見る。
          case cpu.budget <. 0.999999 {
            True -> cpu
            False -> {
              let facing = face(cpu.position, center(next))
              case sight.door_between(map, cpu.cell, next) {
                // 閉じた襖の前では、まず開ける（1歩ぶん）。
                Ok(door) ->
                  case set.contains(cpu.open_doors, door) {
                    False ->
                      walk(
                        OniCpu(
                          ..cpu,
                          open_doors: set.insert(cpu.open_doors, door),
                          facing:,
                          budget: cpu.budget -. 1.0,
                        ),
                        map,
                        layout,
                        guard - 1,
                      )
                    True -> advance(cpu, next, rest, facing, map, layout, guard)
                  }
                Error(Nil) ->
                  advance(cpu, next, rest, facing, map, layout, guard)
              }
            }
          }
      }
  }
}

fn advance(
  cpu: OniCpu,
  next: Cell,
  rest: List(Cell),
  facing: Float,
  map: Map,
  layout: Layout,
  guard: Int,
) -> OniCpu {
  let moved =
    OniCpu(
      ..cpu,
      cell: next,
      position: center(next),
      facing:,
      route: rest,
      budget: cpu.budget -. 1.0,
      trail: [next, ..cpu.trail],
    )
  case rest, moved.goal {
    // 部屋に着いた。部屋の中心を向いて見回す。
    [], Some(slot) ->
      OniCpu(
        ..moved,
        visited: set.insert(moved.visited, slot),
        facing: face(moved.position, room_center(layout, slot)),
        goal: None,
        looking: look_steps,
        budget: 0.0,
      )
    _, _ -> walk(moved, map, layout, guard - 1)
  }
}

/// 次に向かう部屋を選び、そこまでの経路を引く。
fn choose_goal(cpu: OniCpu, map: Map, layout: Layout) -> OniCpu {
  let rooms = room_entries(layout)
  let #(distances, parents) = search(map, cpu.cell)
  let reachable =
    list.filter(rooms, fn(room) { dict.has_key(distances, room.1) })
  // 一巡したら、もう一度巡る。
  let visited = case
    list.all(reachable, fn(room) { set.contains(cpu.visited, room.0) })
  {
    True -> set.new()
    False -> cpu.visited
  }
  let #(goal, visited, seed) =
    pick_room(cpu.params, reachable, distances, visited, cpu.seed, 3)
  case goal {
    Some(#(slot, inner)) -> {
      let route = trace(parents, cpu.cell, inner, [])
      OniCpu(..cpu, goal: Some(slot), route:, visited:, seed:)
    }
    None -> OniCpu(..cpu, goal: None, route: [], visited:, seed:)
  }
}

fn pick_room(
  params: Params,
  rooms: List(#(String, Cell)),
  distances: Dict(Cell, Int),
  visited: Set(String),
  seed: Int,
  tries: Int,
) -> #(Option(#(String, Cell)), Set(String), Int) {
  let unvisited =
    list.filter(rooms, fn(room) { !set.contains(visited, room.0) })
  let done = list.filter(rooms, fn(room) { set.contains(visited, room.0) })
  let #(r_revisit, seed) = roll(seed)
  let #(r_wander, seed) = roll(seed)
  let #(r_pick, seed) = roll(seed)
  let #(r_skip, seed) = roll(seed)
  let chosen = case r_revisit <. params.revisit, done, unvisited {
    True, [_, ..], _ -> nth(done, r_pick)
    _, _, [] -> nth(done, r_pick)
    _, _, _ ->
      case r_wander <. params.wander {
        True -> nth(unvisited, r_pick)
        False -> nearest(unvisited, distances)
      }
  }
  case chosen {
    Ok(room) ->
      case r_skip <. params.skip && tries > 0 && list.length(unvisited) > 1 {
        // 飛ばした部屋は、訪ねたことにして次を選ぶ（精度を粗くする）。
        True ->
          pick_room(
            params,
            rooms,
            distances,
            set.insert(visited, room.0),
            seed,
            tries - 1,
          )
        False -> #(Some(room), visited, seed)
      }
    Error(Nil) -> #(None, visited, seed)
  }
}

fn nearest(
  rooms: List(#(String, Cell)),
  distances: Dict(Cell, Int),
) -> Result(#(String, Cell), Nil) {
  rooms
  |> list.sort(fn(a, b) {
    int.compare(distance_of(distances, a.1), distance_of(distances, b.1))
  })
  |> list.first
}

fn distance_of(distances: Dict(Cell, Int), cell: Cell) -> Int {
  case dict.get(distances, cell) {
    Ok(d) -> d
    Error(Nil) -> 1_000_000
  }
}

fn nth(items: List(a), r: Float) -> Result(a, Nil) {
  let size = list.length(items)
  let index = int.min(float.truncate(r *. int.to_float(size)), size - 1)
  items |> list.drop(index) |> list.first
}

/// 部屋（スロットの ID と、襖をくぐった内側のマス）。
fn room_entries(layout: Layout) -> List(#(String, Cell)) {
  layout.skeleton.slots
  |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
  |> list.filter_map(fn(slot) {
    case slot.doors {
      [door, ..] -> Ok(#(slot.id, door.slot))
      [] -> Error(Nil)
    }
  })
}

fn room_center(layout: Layout, slot_id: String) -> #(Float, Float) {
  case list.find(layout.skeleton.slots, fn(slot) { slot.id == slot_id }) {
    Ok(slot) -> {
      let count = int.to_float(int.max(list.length(slot.cells), 1))
      let sx =
        list.fold(slot.cells, 0.0, fn(acc, c) { acc +. int.to_float(c.x) })
      let sz =
        list.fold(slot.cells, 0.0, fn(acc, c) { acc +. int.to_float(c.z) })
      #(sx /. count +. 0.5, sz /. count +. 0.5)
    }
    Error(Nil) -> #(0.0, 0.0)
  }
}

// --- 経路（幅優先探索） -----------------------------------------------------------

/// 通れる隣のマス。襖は開けて通れるものとして数える。
fn neighbours(map: Map, cell: Cell) -> List(Cell) {
  [
    Cell(cell.x + 1, cell.z),
    Cell(cell.x - 1, cell.z),
    Cell(cell.x, cell.z + 1),
    Cell(cell.x, cell.z - 1),
  ]
  |> list.filter(fn(next) {
    case sight.region_at(map, cell), sight.region_at(map, next) {
      Ok(a), Ok(b) if a == b -> True
      Ok(_), Ok(_) -> sight.door_between(map, cell, next) |> result_is_ok
      _, _ -> False
    }
  })
}

fn result_is_ok(result: Result(a, b)) -> Bool {
  case result {
    Ok(_) -> True
    Error(_) -> False
  }
}

/// from から各マスまでの歩数と、経路を辿るための1つ前のマス（幅優先探索）。
fn search(map: Map, from: Cell) -> #(Dict(Cell, Int), Dict(Cell, Cell)) {
  bfs(map, [from], 0, dict.from_list([#(from, 0)]), dict.new())
}

/// trace は from から to までの経路（from を含まず、to を含む）。着けなければ空。
fn trace(parents: Dict(Cell, Cell), from: Cell, cell: Cell, acc: List(Cell)) {
  case cell == from {
    True -> acc
    False ->
      case dict.get(parents, cell) {
        Ok(parent) -> trace(parents, from, parent, [cell, ..acc])
        Error(Nil) -> []
      }
  }
}

/// 1段ずつ広げる幅優先探索（キューを使わず、段ごとのリストで O(マス数)）。
fn bfs(
  map: Map,
  frontier: List(Cell),
  depth: Int,
  distances: Dict(Cell, Int),
  parents: Dict(Cell, Cell),
) -> #(Dict(Cell, Int), Dict(Cell, Cell)) {
  case frontier {
    [] -> #(distances, parents)
    _ -> {
      let #(next, distances, parents) =
        list.fold(frontier, #([], distances, parents), fn(acc, cell) {
          list.fold(neighbours(map, cell), acc, fn(acc, n) {
            let #(next, distances, parents) = acc
            case dict.has_key(distances, n) {
              True -> acc
              False -> #(
                [n, ..next],
                dict.insert(distances, n, depth + 1),
                dict.insert(parents, n, cell),
              )
            }
          })
        })
      bfs(map, next, depth + 1, distances, parents)
    }
  }
}

// --- 発見 ----------------------------------------------------------------

fn detect(
  cpu: OniCpu,
  map: Map,
  layout: Layout,
  hiders: List(Hider(id)),
) -> #(List(id), List(id), Int) {
  let #(found, seen, seed) =
    list.fold(hiders, #([], [], cpu.seed), fn(acc, hider) {
      let #(found, seen, seed) = acc
      let target = #(hider.x, hider.z)
      case
        sight.can_see(
          map,
          cpu.open_doors,
          cpu.position,
          cpu.facing,
          cpu.view,
          target,
        )
      {
        False -> acc
        True -> {
          let dx = hider.x -. cpu.position.0
          let dz = hider.z -. cpu.position.1
          let distance = sqrt(dx *. dx +. dz *. dz)
          let blend =
            1.0
            -. palette.difference(
              hider.color,
              palette.place_color(layout, sight.cell_of(target)),
            )
          let chance = find_chance(cpu.params, cpu.view, distance, blend)
          let #(r, seed) = roll(seed)
          case r <. chance {
            True -> #([hider.id, ..found], [hider.id, ..seen], seed)
            False -> #(found, [hider.id, ..seen], seed)
          }
        }
      }
    })
  #(list.reverse(found), list.reverse(seen), seed)
}

// --- 補助 ----------------------------------------------------------------

/// stage.draw が返せる値の幅（線形合同法の上位15ビット）。
const roll_resolution = 32_768

/// 0 以上 1 未満の乱数と、次の種。
fn roll(seed: Int) -> #(Float, Int) {
  let #(value, seed) = stage.draw(seed, roll_resolution)
  #(int.to_float(value) /. int.to_float(roll_resolution), seed)
}

fn center(cell: Cell) -> #(Float, Float) {
  #(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5)
}

fn face(from: #(Float, Float), to: #(Float, Float)) -> Float {
  let dx = to.0 -. from.0
  let dz = to.1 -. from.1
  case dx == 0.0 && dz == 0.0 {
    True -> 0.0
    False -> sight.normalize_angle(atan2(dz, dx))
  }
}

@external(erlang, "math", "atan2")
fn atan2(y: Float, x: Float) -> Float

@external(erlang, "math", "sqrt")
fn sqrt(x: Float) -> Float
