/// 骨格の検算（issue-65 / ADR 0048）。純粋な関数で、骨格（stage.Skeleton）を読むだけ。
///
/// - 共通の条件（どの骨格も満たす / ADR 0032）: 玄関から、すべてのスロットの襖へ歩いて着ける。スロットの
///   襖は 1 つで、廊下に面する。2 つのスロットに接する襖（部屋どうしをつなぐ襖）は無い。スロットの大きさは、
///   大 4 x 6 m、小 2 x 1 m。玄関がある
/// - 種類ごとの設定（limits）: スロットの数、割り当てる部屋の数の範囲、まっすぐな廊下の最長、行き止まりと
///   分かれ道（広い屋敷の格子の節点で数える）、玄関から最も遠い襖までの道のり、幅
///
/// ふつう（既存の 10 種）の設定は、stage.gleam の構成の幅と、いまのデータの実測から取る（値は変えない）。
/// 広い屋敷の設定は、issue-65 の決定のとおり。
import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order
import gleam/set.{type Set}
import gleam/string
import rondo_server/games/veryare/stage.{
  type Cell, type Kind, type Skeleton, type Slot, Cell, Large, Normal, Small,
  Wide,
}

// --- 種類と設定 ------------------------------------------------------------------

/// 両端を含む範囲。
pub type Range {
  Range(min: Int, max: Int)
}

pub type Limits {
  Limits(
    large: Range,
    small: Range,
    /// スロットの数（大と小の合計）。記号は 1 文字で 1 スロット（大 A〜Z、小 a〜z）なので、52 まで。
    total: Range,
    /// 割り当てる和室系の数（stage.gleam の assign の幅）。
    washitsu: Range,
    /// 割り当てる押し入れの数（部屋内包と独立の合計）。
    oshiire: Range,
    /// まっすぐな廊下（曲がらずに進める、廊下のマスの並び）の最長（メートル）。
    straight_max: Int,
    /// 行き止まり・分かれ道の数（広い屋敷の格子の節点で数える）。ふつうは数えない。
    dead_ends: Option(Range),
    branches: Option(Range),
    /// 玄関から最も遠い襖までの道のり（メートル）の上限。
    farthest_door_max: Int,
    /// 地図の幅（メートル）。
    width: Range,
  )
}

/// 始まりの案内で、広い屋敷かを見分ける幅（メートル）。10 種の最大の幅 < これ ≤ 広い屋敷の最小の幅。
pub const wide_min_width = 20

/// 歩く速さ（m/秒。apps/web の motion.ts の WALK_SPEED と同じ）。
const walk_speed = 4.5

pub fn limits(kind: Kind) -> Limits {
  case kind {
    Normal ->
      Limits(
        large: Range(10, 12),
        small: Range(2, 4),
        total: Range(12, 16),
        washitsu: Range(stage.min_washitsu, stage.max_washitsu),
        oshiire: Range(stage.min_oshiire, stage.max_oshiire),
        // いまのデータの最長（骨格 10 の中廊下）。ふつうは、長い廊下を制限しない。
        straight_max: 53,
        dead_ends: None,
        branches: None,
        // 準備移動 20 秒のうち、見回しの 5 秒を残した 15 秒で歩ける距離（4.5 m/秒 × 15 秒 = 67.5 m）。
        farthest_door_max: 67,
        width: Range(13, wide_min_width - 1),
      )
    Wide ->
      Limits(
        large: Range(22, 26),
        small: Range(20, 26),
        total: Range(46, 52),
        washitsu: Range(18, 24),
        oshiire: Range(7, 11),
        // 部屋 2 つ分（12 m）に、曲がり角の幅（2 m）を足した長さ。
        straight_max: 14,
        dead_ends: Some(Range(5, 12)),
        branches: Some(Range(4, 10)),
        farthest_door_max: 150,
        width: Range(wide_min_width, 40),
      )
  }
}

// --- 数える ----------------------------------------------------------------------

pub type Stats {
  Stats(
    large: Int,
    small: Int,
    /// まっすぐな廊下の最長（メートル）。
    straight: Int,
    /// 広い屋敷の格子に乗っていれば、行き止まり（節点の次数 1）と分かれ道（次数 3 以上）の数。
    dead_ends: Option(Int),
    branches: Option(Int),
    /// 玄関から最も遠い襖までの道のり（メートル。襖を全部開けた、準備移動の道）。
    farthest_door: Int,
    width: Int,
    depth: Int,
  )
}

pub fn stats(skeleton: Skeleton) -> Stats {
  let count = fn(size) {
    list.count(skeleton.slots, fn(slot: Slot) { slot.size == size })
  }
  let degrees = case lattice_degrees(skeleton) {
    Ok(degrees) -> Some(degrees)
    Error(_) -> None
  }
  Stats(
    large: count(Large),
    small: count(Small),
    straight: straight(skeleton),
    dead_ends: option.map(degrees, list.count(_, fn(d) { d == 1 })),
    branches: option.map(degrees, list.count(_, fn(d) { d >= 3 })),
    farthest_door: farthest_door(skeleton),
    width: skeleton.width,
    depth: skeleton.depth,
  )
}

/// 最も遠い襖までの道のり（メートル）から、準備移動の時間（秒）。道のり ÷ 4.5 m/秒 + 余裕 5 秒を、
/// 5 秒単位に切り上げ、30〜50 秒に収める（広い屋敷 / issue-65。10 種は 20 秒のまま）。
pub fn preparation_seconds(farthest_door_m: Int) -> Int {
  let seconds = int.to_float(farthest_door_m) /. walk_speed +. 5.0
  let rounded = float.round(float.ceiling(seconds /. 5.0)) * 5
  int.clamp(rounded, min: 30, max: 50)
}

// --- 検算 ------------------------------------------------------------------------

/// 共通の条件と、種類ごとの設定の、両方の問題（無ければ空）。
pub fn problems(skeleton: Skeleton, kind: Kind) -> List(String) {
  list.append(common_problems(skeleton), limit_problems(skeleton, kind))
}

/// どの骨格も満たす条件の問題（無ければ空）。
pub fn common_problems(skeleton: Skeleton) -> List(String) {
  let slots = skeleton.slots
  let sizes =
    list.filter_map(slots, fn(slot) {
      case size_of(slot) {
        Ok(_) -> Error(Nil)
        Error(#(w, d)) ->
          Ok(
            "大きさの違うスロット: "
            <> slot.id
            <> "（"
            <> int.to_string(w)
            <> " x "
            <> int.to_string(d)
            <> "）",
          )
      }
    })
  let doors =
    list.filter_map(slots, fn(slot) {
      case list.length(slot.doors) {
        1 -> Error(Nil)
        n ->
          Ok("襖が 1 つでないスロット: " <> slot.id <> "（" <> int.to_string(n) <> " つ）")
      }
    })
  let shared =
    slots
    |> list.flat_map(fn(slot) { list.map(slot.doors, fn(d) { d.corridor }) })
    |> list.group(fn(cell) { cell })
    |> dict.to_list
    |> list.filter(fn(entry) { list.length(entry.1) > 1 })
    |> list.map(fn(entry) { entry.0 })
    |> list.sort(compare_cells)
    |> list.map(fn(cell) { "2 つのスロットに接する襖: " <> show(cell) })
  let reached = distances(skeleton)
  let unreachable =
    list.filter_map(slots, fn(slot) {
      case list.any(slot.doors, fn(d) { dict.has_key(reached, d.corridor) }) {
        True -> Error(Nil)
        False -> Ok("玄関から着けないスロット: " <> slot.id)
      }
    })
  let entrance = case skeleton.entrance {
    [] -> ["玄関が無い"]
    _ -> []
  }
  list.flatten([entrance, sizes, doors, shared, unreachable])
}

fn limit_problems(skeleton: Skeleton, kind: Kind) -> List(String) {
  let limits = limits(kind)
  let stats = stats(skeleton)
  let total = stats.large + stats.small
  let within = fn(name: String, value: Int, range: Range) {
    case value >= range.min && value <= range.max {
      True -> []
      False -> [
        name
        <> "が範囲の外: "
        <> int.to_string(value)
        <> "（"
        <> int.to_string(range.min)
        <> "〜"
        <> int.to_string(range.max)
        <> "）",
      ]
    }
  }
  let optional = fn(name: String, value: Option(Int), range: Option(Range)) {
    case range, value {
      None, _ -> []
      Some(range), Some(value) -> within(name, value, range)
      Some(_), None -> [name <> "を数えられない（広い屋敷の格子に乗っていない）"]
    }
  }
  let rooms = case
    limits.washitsu.min <= stats.large,
    limits.oshiire.min <= limits.washitsu.min + stats.small
  {
    True, True -> []
    _, _ -> ["割り当てる部屋の数の範囲を、スロットに収められない"]
  }
  let straight = case stats.straight <= limits.straight_max {
    True -> []
    False -> [
      "まっすぐな廊下が長すぎる: " <> int.to_string(stats.straight) <> " m",
    ]
  }
  let farthest = case stats.farthest_door <= limits.farthest_door_max {
    True -> []
    False -> [
      "最も遠い襖までの道のりが長すぎる: " <> int.to_string(stats.farthest_door) <> " m",
    ]
  }
  list.flatten([
    within("大スロットの数", stats.large, limits.large),
    within("小スロットの数", stats.small, limits.small),
    within("スロットの数", total, limits.total),
    rooms,
    straight,
    optional("行き止まりの数", stats.dead_ends, limits.dead_ends),
    optional("分かれ道の数", stats.branches, limits.branches),
    farthest,
    within("幅", stats.width, limits.width),
  ])
}

// --- 形 --------------------------------------------------------------------------

/// スロットの大きさ。欠けのない長方形で、決まった大きさなら Ok。違えば Error（幅 x 奥行き）。
fn size_of(slot: Slot) -> Result(Nil, #(Int, Int)) {
  let xs = list.map(slot.cells, fn(c) { c.x })
  let zs = list.map(slot.cells, fn(c) { c.z })
  let span = fn(values: List(Int)) {
    let low = list.fold(values, 1_000_000, int.min)
    let high = list.fold(values, -1_000_000, int.max)
    high - low + 1
  }
  let w = span(xs)
  let d = span(zs)
  let dims = list.sort([w, d], int.compare)
  let expected = case slot.size {
    Large -> [4, 6]
    Small -> [1, 2]
  }
  case list.length(slot.cells) == w * d && dims == expected {
    True -> Ok(Nil)
    False -> Error(#(w, d))
  }
}

/// 廊下（. と +）のマスが、縦か横に、途切れずに並ぶ最長の数。
fn straight(skeleton: Skeleton) -> Int {
  let corridor = set.from_list(skeleton.corridor)
  let run = fn(cells: List(Cell)) {
    list.fold(cells, #(0, 0), fn(acc, cell) {
      let #(current, best) = acc
      case set.contains(corridor, cell) {
        True -> #(current + 1, int.max(best, current + 1))
        False -> #(0, best)
      }
    }).1
  }
  let rows =
    between(0, skeleton.depth - 1)
    |> list.map(fn(z) {
      run(list.map(between(0, skeleton.width - 1), fn(x) { Cell(x, z) }))
    })
  let columns =
    between(0, skeleton.width - 1)
    |> list.map(fn(x) {
      run(list.map(between(0, skeleton.depth - 1), fn(z) { Cell(x, z) }))
    })
  list.fold(list.append(rows, columns), 0, int.max)
}

/// 玄関のマス（距離 0）から、歩けるマス（廊下・縁側・玄関）をたどった、マスごとの距離。
fn distances(skeleton: Skeleton) -> dict.Dict(Cell, Int) {
  let walkable = set.from_list(skeleton.walkable)
  let start =
    list.fold(skeleton.entrance, dict.new(), fn(acc, c) {
      dict.insert(acc, c, 0)
    })
  bfs(walkable, skeleton.entrance, [], start, 0)
}

fn bfs(
  walkable: Set(Cell),
  frontier: List(Cell),
  next: List(Cell),
  seen: dict.Dict(Cell, Int),
  depth: Int,
) -> dict.Dict(Cell, Int) {
  case frontier, next {
    [], [] -> seen
    [], _ -> bfs(walkable, list.reverse(next), [], seen, depth + 1)
    [cell, ..rest], _ -> {
      let fresh =
        neighbours(cell)
        |> list.filter(fn(n) {
          set.contains(walkable, n) && !dict.has_key(seen, n)
        })
      let seen =
        list.fold(fresh, seen, fn(acc, n) { dict.insert(acc, n, depth + 1) })
      bfs(walkable, rest, list.append(fresh, next), seen, depth)
    }
  }
}

fn farthest_door(skeleton: Skeleton) -> Int {
  let reached = distances(skeleton)
  skeleton.slots
  |> list.flat_map(fn(slot) { slot.doors })
  |> list.filter_map(fn(door) { dict.get(reached, door.corridor) })
  |> list.fold(0, int.max)
}

fn neighbours(cell: Cell) -> List(Cell) {
  [
    Cell(cell.x + 1, cell.z),
    Cell(cell.x - 1, cell.z),
    Cell(cell.x, cell.z + 1),
    Cell(cell.x, cell.z - 1),
  ]
}

fn compare_cells(a: Cell, b: Cell) {
  case int.compare(a.z, b.z) {
    order.Eq -> int.compare(a.x, b.x)
    other -> other
  }
}

fn show(cell: Cell) -> String {
  "(" <> int.to_string(cell.x) <> ", " <> int.to_string(cell.z) <> ")"
}

// --- 広い屋敷の格子 --------------------------------------------------------------------

/// 広い屋敷の格子（tools/wide_skeletons.mjs と同じ）。節点（2 x 2 m の曲がり角）を、横 6 m・縦 8 m おきに
/// 5 x 8 個並べ、節点の間を 2 m 幅の廊下でつなぐ。
pub const lattice_columns = 5

pub const lattice_rows = 8

pub const lattice_pitch_x = 6

pub const lattice_pitch_z = 8

/// 格子の節点ごとの次数（つながった廊下の数）。廊下が格子に乗っていなければ Error（理由）。格子の原点は、
/// 廊下のマスのいちばん左上（どの節点も、廊下でつながっている前提）。
pub fn lattice_degrees(skeleton: Skeleton) -> Result(List(Int), String) {
  let corridor = set.from_list(skeleton.corridor)
  let x0 =
    list.fold(skeleton.corridor, 1_000_000, fn(acc, c) { int.min(acc, c.x) })
  let z0 =
    list.fold(skeleton.corridor, 1_000_000, fn(acc, c) { int.min(acc, c.z) })
  let node = fn(i, j) {
    cells(
      x0 + i * lattice_pitch_x,
      x0 + i * lattice_pitch_x + 1,
      z0 + j * lattice_pitch_z,
      z0 + j * lattice_pitch_z + 1,
    )
  }
  let horizontal = fn(i, j) {
    cells(
      x0 + i * lattice_pitch_x + 2,
      x0 + { i + 1 } * lattice_pitch_x - 1,
      z0 + j * lattice_pitch_z,
      z0 + j * lattice_pitch_z + 1,
    )
  }
  let vertical = fn(i, j) {
    cells(
      x0 + i * lattice_pitch_x,
      x0 + i * lattice_pitch_x + 1,
      z0 + j * lattice_pitch_z + 2,
      z0 + { j + 1 } * lattice_pitch_z - 1,
    )
  }
  let nodes =
    list.flat_map(between(0, lattice_rows - 1), fn(j) {
      list.map(between(0, lattice_columns - 1), fn(i) { #(i, j) })
    })
  let edges =
    list.flatten([
      list.filter_map(nodes, fn(n) {
        case n.0 < lattice_columns - 1 {
          True -> Ok(#(n, #(n.0 + 1, n.1), horizontal(n.0, n.1)))
          False -> Error(Nil)
        }
      }),
      list.filter_map(nodes, fn(n) {
        case n.1 < lattice_rows - 1 {
          True -> Ok(#(n, #(n.0, n.1 + 1), vertical(n.0, n.1)))
          False -> Error(Nil)
        }
      }),
    ])
  let partial =
    list.find(edges, fn(e) {
      let inside = list.count(e.2, set.contains(corridor, _))
      inside != 0 && inside != list.length(e.2)
    })
  let present =
    list.filter(edges, fn(e) { list.all(e.2, set.contains(corridor, _)) })
  let covered =
    set.from_list(
      list.flatten([
        list.flat_map(nodes, fn(n) { node(n.0, n.1) }),
        list.flat_map(present, fn(e) { e.2 }),
      ]),
    )
  let stray = list.find(skeleton.corridor, fn(c) { !set.contains(covered, c) })
  let degrees =
    list.map(nodes, fn(n) {
      list.count(present, fn(e) { e.0 == n || e.1 == n })
    })
  let missing_node =
    list.find(nodes, fn(n) {
      !list.all(node(n.0, n.1), set.contains(corridor, _))
    })
  case partial, stray, missing_node {
    Ok(_), _, _ -> Error("途中で切れた廊下がある")
    _, Ok(cell), _ -> Error("格子の外の廊下: " <> show(cell))
    _, _, Ok(_) -> Error("廊下でつながっていない節点がある")
    _, _, _ -> Ok(degrees)
  }
}

/// from から to まで（両端を含む）。to が from より小さければ空。
fn between(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..between(from + 1, to)]
  }
}

fn cells(x_from: Int, x_to: Int, z_from: Int, z_to: Int) -> List(Cell) {
  list.flat_map(between(z_from, z_to), fn(z) {
    list.map(between(x_from, x_to), fn(x) { Cell(x, z) })
  })
}

/// 文字地図の大きさ（バイト。行の文字の合計。ステージの通知の rows の大きさの目安）。
pub fn rows_bytes(rows: List(String)) -> Int {
  list.fold(rows, 0, fn(acc, row) { acc + string.byte_size(row) })
}
