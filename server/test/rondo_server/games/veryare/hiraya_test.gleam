//// 平屋の固定ステージ（issue-44 / ADR 0039）の、データの検算と、移動の規則（issue-29a）に
//// 平屋のデータを入れたときの止まり方。
////
//// 開口の値は、手元の資料（assets-src/house/doors-fbx.tsv の戸の外枠、掃き出し窓は
//// docs/stage-hiraya-proposal.md の外壁の開口）を、ここに書き写したもの。素材のファイルは読まない。
////
//// 共有の見本（packages/contracts/src/fixtures/veryare-hiraya-stage.json）が、平屋のデータと
//// 移動の規則に一致することも確かめる（クライアントは同じ見本で、同じ止まり方を確かめる）。

import gleam/bit_array
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/json
import gleam/list
import gleam/set.{type Set}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/grid.{type Edge, type Grid}
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/stage.{type Cell, Cell}
import rondo_server/games/veryare/stage_notice
import rondo_server/protocol/message

// --- 補助 ---------------------------------------------------------------

fn the_grid() -> Grid {
  hiraya.grid()
}

/// マスの文字（地図の外は "~" とみなす）。
fn char_at(cell: Cell) -> String {
  case list.drop(hiraya.rows, cell.z) |> list.first {
    Ok(row) ->
      case string.slice(row, cell.x, 1) {
        "" -> "~"
        char -> char
      }
    Error(Nil) -> "~"
  }
}

fn all_cells() -> List(Cell) {
  upto(hiraya.depth)
  |> list.flat_map(fn(z) {
    upto(hiraya.width) |> list.map(fn(x) { Cell(x, z) })
  })
}

/// 0 から n - 1 まで。
fn upto(n: Int) -> List(Int) {
  int.range(from: 0, to: n, with: [], run: list.prepend) |> list.reverse
}

fn walkable_cells() -> List(Cell) {
  list.filter(all_cells(), fn(cell) { grid.walkable(the_grid(), cell) })
}

fn neighbors(cell: Cell) -> List(Cell) {
  [
    Cell(cell.x + 1, cell.z),
    Cell(cell.x - 1, cell.z),
    Cell(cell.x, cell.z + 1),
    Cell(cell.x, cell.z - 1),
  ]
}

/// 玄関のマスから、通れる境だけをたどって着けるマス（幅優先）。
fn reachable(open: Set(Edge)) -> Set(Cell) {
  let g = the_grid()
  let start = grid.cell_at(g, hiraya.spawn)
  visit(g, open, [start], set.from_list([start]))
}

fn visit(g: Grid, open: Set(Edge), queue: List(Cell), seen: Set(Cell)) {
  case queue {
    [] -> seen
    [cell, ..rest] -> {
      let next =
        neighbors(cell)
        |> list.filter(fn(n) {
          !set.contains(seen, n) && grid.passable(g, open, cell, n)
        })
      visit(g, open, list.append(rest, next), list.fold(next, seen, set.insert))
    }
  }
}

fn door_named(name: String) -> hiraya.Door {
  let assert Ok(door) = list.find(hiraya.doors, fn(d) { d.name == name })
  door
}

fn center_of(cell: Cell) -> #(Float, Float) {
  let #(ox, oz) = hiraya.origin
  #(
    ox +. hiraya.cell_size *. { int.to_float(cell.x) +. 0.5 },
    oz +. hiraya.cell_size *. { int.to_float(cell.z) +. 0.5 },
  )
}

fn close(a: Float, b: Float, tolerance: Float) -> Bool {
  float.absolute_value(a -. b) <=. tolerance
}

// --- 地図 ---------------------------------------------------------------

/// 41 列 × 45 行で、記号は決めたものだけ。歩けるのは "~" 以外のマス。
pub fn map_has_the_agreed_shape_and_symbols_test() {
  hiraya.width |> should.equal(41)
  hiraya.depth |> should.equal(45)
  hiraya.cell_size |> should.equal(0.3)
  hiraya.origin |> should.equal(#(-6.225, -0.275))
  list.length(hiraya.rows) |> should.equal(45)
  let symbols = set.from_list(string.to_graphemes("~=:.@ABCDKFWTo"))
  list.each(hiraya.rows, fn(row) {
    string.length(row) |> should.equal(41)
    string.to_graphemes(row)
    |> list.each(fn(char) { set.contains(symbols, char) |> should.be_true })
  })
  list.each(all_cells(), fn(cell) {
    grid.walkable(the_grid(), cell) |> should.equal(char_at(cell) != "~")
  })
}

/// 記号ごとに別の領域（廊下と玄関、広縁と縁側の間にも戸があるため）。
pub fn each_symbol_is_its_own_region_test() {
  let names = list.map(hiraya.regions, fn(entry) { entry.1 })
  list.length(hiraya.regions) |> should.equal(13)
  set.size(set.from_list(names)) |> should.equal(13)
  list.any(hiraya.regions, fn(entry) { entry.0 == "~" }) |> should.be_false
}

// --- 到達 ---------------------------------------------------------------

/// 襖を全部開けると、玄関から歩けるすべてのマスに着ける。
pub fn all_cells_are_reachable_with_every_fusuma_open_test() {
  let g = the_grid()
  reachable(grid.fusuma(g))
  |> should.equal(set.from_list(walkable_cells()))
}

/// 襖を全部閉じると、玄関・東の廊下・洗面所・風呂・トイレだけに着ける。
pub fn only_the_entrance_side_is_reachable_with_every_fusuma_closed_test() {
  reachable(set.new())
  |> set.to_list
  |> list.map(char_at)
  |> set.from_list
  |> should.equal(set.from_list(["@", ".", "W", "F", "T"]))
}

// --- 戸 -----------------------------------------------------------------

/// 戸は 20 個（襖 10、いつも開いている 8、いつも閉じている 2）。
pub fn there_are_twenty_doors_of_three_kinds_test() {
  let count = fn(kind) {
    list.count(hiraya.doors, fn(door) { door.kind == kind })
  }
  list.length(hiraya.doors) |> should.equal(20)
  count(grid.Fusuma) |> should.equal(10)
  count(grid.AlwaysOpen) |> should.equal(8)
  count(grid.AlwaysClosed) |> should.equal(2)
}

/// どの戸も、境の1辺ずつが、隣り合う2つの異なる領域のマスの間にあり、戸どうしで辺が重ならない。
pub fn every_door_lies_between_two_different_regions_test() {
  list.each(hiraya.doors, fn(door) {
    let edges = hiraya.edges(door)
    { edges != [] } |> should.be_true
    list.each(edges, fn(edge) {
      stage.adjacent(edge.a, edge.b) |> should.be_true
      { char_at(edge.a) != char_at(edge.b) } |> should.be_true
    })
    // 戸のどの辺も、同じ2つの記号の間にある（ほかの部屋へはみ出さない）。
    edges
    |> list.map(fn(edge) { set.from_list([char_at(edge.a), char_at(edge.b)]) })
    |> set.from_list
    |> set.size
    |> should.equal(1)
  })
  let all = list.flat_map(hiraya.doors, hiraya.edges)
  set.size(set.from_list(all)) |> should.equal(list.length(all))
}

/// 片開き戸・玄関の戸・勝手口は襖でない。
pub fn hinged_doors_entrance_and_back_door_are_not_fusuma_test() {
  [
    "風呂-洗面所 片開き戸", "洗面所-東の廊下 片開き戸", "トイレ-東の廊下 片開き戸", "玄関 引違い戸（外へ）",
    "キッチン 勝手口（外へ）",
  ]
  |> list.each(fn(name) {
    { door_named(name).kind != grid.Fusuma } |> should.be_true
  })
  door_named("玄関 引違い戸（外へ）").kind |> should.equal(grid.AlwaysClosed)
  door_named("キッチン 勝手口（外へ）").kind |> should.equal(grid.AlwaysClosed)
}

/// 戸の辺の数（提案書の表のマス数）。
pub fn door_widths_follow_the_table_test() {
  [
    #("押入れ 2枚戸 西", 6),
    #("押入れ 2枚戸 東", 6),
    #("和室A-ダイニング 4枚戸", 12),
    #("和室B-和室C 4枚戸", 12),
    #("和室C-ダイニング 4枚戸", 12),
    #("和室C-東の廊下 4枚戸", 12),
    #("和室A-広縁 障子", 12),
    #("和室B-広縁 障子（西）", 12),
    #("和室B-広縁 障子（南）", 12),
    #("和室C-広縁 障子（南）", 12),
    #("風呂-洗面所 片開き戸", 3),
    #("洗面所-東の廊下 片開き戸", 3),
    #("トイレ-東の廊下 片開き戸", 3),
    #("キッチン-ダイニング ガラス戸", 12),
    #("東の廊下-玄関 通り抜け", 7),
    #("広縁-縁側 掃き出し窓（西の北）", 12),
    #("広縁-縁側 掃き出し窓（西の南）", 12),
    #("広縁-縁側 掃き出し窓（南）", 12),
    #("玄関 引違い戸（外へ）", 6),
    #("キッチン 勝手口（外へ）", 3),
  ]
  |> list.each(fn(entry) {
    list.length(hiraya.edges(door_named(entry.0))) |> should.equal(entry.1)
  })
}

/// 開口（戸の外枠の中心と幅）。axis は開口の長辺の向き（"x" なら境は z が一定の線）。
type Opening {
  Opening(name: String, axis: String, x: Float, z: Float, width: Float)
}

/// doors-fbx.tsv の戸の外枠（親の無い行）と、提案書の掃き出し窓の外壁の開口。
/// ガラス戸と、東の廊下-玄関の通り抜けは、どちらの資料にも開口の値が無いので載せない
/// （境が2つの領域の間にあることは、上のテストで確かめる）。
fn openings() -> List(Opening) {
  [
    Opening("押入れ 2枚戸 西", "x", -2.8, 1.45, 1.8),
    Opening("押入れ 2枚戸 東", "x", -1.0, 1.45, 1.8),
    Opening("和室A-ダイニング 4枚戸", "z", -0.05, 4.15, 3.56),
    Opening("和室B-和室C 4枚戸", "z", -0.05, 8.8, 3.56),
    Opening("和室C-ダイニング 4枚戸", "x", 1.8, 6.05, 3.56),
    Opening("和室C-東の廊下 4枚戸", "z", 3.65, 8.8, 3.56),
    Opening("和室A-広縁 障子", "z", -3.75, 4.2, 3.56),
    Opening("和室B-広縁 障子（西）", "z", -3.75, 8.8, 3.56),
    Opening("和室B-広縁 障子（南）", "x", -1.9, 10.65, 3.56),
    Opening("和室C-広縁 障子（南）", "x", 1.8, 10.65, 3.56),
    Opening("風呂-洗面所 片開き戸", "x", 4.1, 1.817, 0.76),
    Opening("洗面所-東の廊下 片開き戸", "x", 4.2, 3.716, 0.86),
    Opening("トイレ-東の廊下 片開き戸", "x", 5.3, 5.316, 0.86),
    Opening("玄関 引違い戸（外へ）", "x", 4.7, 12.0, 1.8),
    Opening("キッチン 勝手口（外へ）", "x", 0.5, 0.1, 0.86),
    Opening("広縁-縁側 掃き出し窓（西の北）", "z", -5.1, 4.2, 3.56),
    Opening("広縁-縁側 掃き出し窓（西の南）", "z", -5.1, 8.8, 3.56),
    Opening("広縁-縁側 掃き出し窓（南）", "x", -1.9, 12.0, 3.56),
  ]
}

/// 各戸の範囲（境の線・中心・幅）が、開口と 0.3 m 以内で合う。
pub fn doors_match_the_openings_within_a_cell_test() {
  list.length(openings()) |> should.equal(18)
  let #(ox, oz) = hiraya.origin
  let s = hiraya.cell_size
  list.each(openings(), fn(opening) {
    let edges = hiraya.edges(door_named(opening.name))
    let assert [first, ..] = edges
    let horizontal = first.a.x == first.b.x
    // 開口の長辺の向きと、境の向きが合う（x 方向の開口は、z が一定の境）。
    horizontal |> should.equal(opening.axis == "x")
    let along =
      list.map(edges, fn(e) {
        case horizontal {
          True -> e.a.x
          False -> e.a.z
        }
      })
    let assert Ok(lo) = list.reduce(along, fn(a, b) { int.min(a, b) })
    let assert Ok(hi) = list.reduce(along, fn(a, b) { int.max(a, b) })
    // 境の線の位置・範囲の両端と、比べる開口の線・中心。
    let #(line, start, end, opening_line, opening_center) = case horizontal {
      True -> {
        let line = oz +. s *. int.to_float(int.max(first.a.z, first.b.z))
        let start = ox +. s *. int.to_float(lo)
        let end = ox +. s *. int.to_float(hi + 1)
        #(line, start, end, opening.z, opening.x)
      }
      False -> {
        let line = ox +. s *. int.to_float(int.max(first.a.x, first.b.x))
        let start = oz +. s *. int.to_float(lo)
        let end = oz +. s *. int.to_float(hi + 1)
        #(line, start, end, opening.x, opening.z)
      }
    }
    // 境の線は開口の中心の線と、範囲の中心は開口の中心と、幅は開口の幅と、0.3 m 以内。
    close(line, opening_line, 0.3) |> should.be_true
    close({ start +. end } /. 2.0, opening_center, 0.3) |> should.be_true
    close(end -. start, opening.width, 0.3) |> should.be_true
  })
}

// --- 床の矩形 -----------------------------------------------------------

/// 床の矩形（建物の床・縁側・掃き出し窓の開口。glb の x, z）。提案書の「サーバーの移動範囲」。
fn floors() -> List(#(Float, Float, Float, Float)) {
  [
    #(-5.0, 5.8, 0.2, 11.9),
    #(-6.2, -5.2, 1.45, 13.1),
    #(-6.2, 0.05, 12.1, 13.1),
    #(-5.2, -5.0, 2.42, 5.98),
    #(-5.2, -5.0, 7.02, 10.58),
    #(-3.68, -0.12, 11.9, 12.1),
  ]
}

fn on_a_floor(cell: Cell, margin: Float) -> Bool {
  let #(x, z) = center_of(cell)
  list.any(floors(), fn(r) {
    let #(x0, x1, z0, z1) = r
    x >=. x0 -. margin
    && x <=. x1 +. margin
    && z >=. z0 -. margin
    && z <=. z1 +. margin
  })
}

/// 歩けるマスの中心は、どれかの床の矩形の内側にある。
///
/// 0.3 m の格子は、壁の中心線を 0.125 m 以内で格子の線に乗せている（提案書）。そのため、外壁に
/// 接するマスの一部（北の端の行 1 の 36 マスと、縁側の列 3 の、掃き出し窓の無い行の 11 マス）は、
/// 中心が外壁の厚み（0.2 m）の中へ 0.025 m 入る。許容は、外壁の厚みの半分より小さい 0.05 m とし、
/// はみ出すマスの数も固定して、地図が変わったら気づけるようにする。
pub fn walkable_cell_centers_are_on_a_floor_test() {
  list.each(walkable_cells(), fn(cell) {
    on_a_floor(cell, 0.05) |> should.be_true
  })
  walkable_cells()
  |> list.filter(fn(cell) { !on_a_floor(cell, 0.0) })
  |> list.partition(fn(cell) { cell.z == 1 })
  |> fn(parts) { #(list.length(parts.0), list.length(parts.1)) }
  |> should.equal(#(36, 11))
}

// --- リスポーン ---------------------------------------------------------

/// リスポーン位置は、玄関の (4.7, 11.3)。マスでは列 36・行 38 の玄関。
pub fn spawn_is_in_the_entrance_test() {
  hiraya.spawn |> should.equal(#(4.7, 11.3))
  let cell = grid.cell_at(the_grid(), hiraya.spawn)
  cell |> should.equal(Cell(36, 38))
  char_at(cell) |> should.equal("@")
}

// --- 襖の組 -------------------------------------------------------------

/// 襖の組: どの辺から引いても、その襖の辺が全部そろう。隣り合う押入れの2組は混ざらない。
pub fn fusuma_groups_follow_the_door_list_test() {
  let g = the_grid()
  list.each(hiraya.doors, fn(door) {
    let edges = hiraya.edges(door)
    case door.kind {
      grid.Fusuma ->
        list.each(edges, fn(edge) {
          grid.door_group(g, edge) |> should.equal(set.from_list(edges))
        })
      _ -> Nil
    }
  })
  set.size(grid.fusuma(g)) |> should.equal(108)
}

// --- 移動の規則（issue-29a）に平屋を入れる -------------------------------

fn step(open: Set(Edge), from: Cell, to: Cell) -> Cell {
  let g = the_grid()
  grid.cell_at(g, grid.step(g, open, center_of(from), center_of(to)))
}

/// 壁（和室A とキッチンの間）は、襖を全部開けていても越えられない。
pub fn walls_stop_movement_test() {
  let g = the_grid()
  let stop = step(grid.fusuma(g), Cell(18, 7), Cell(24, 7))
  char_at(stop) |> should.equal("A")
  stop |> should.equal(Cell(20, 7))
}

/// 閉じた襖（和室A-ダイニング）は手前で止まり、開いていれば通れる。
pub fn closed_fusuma_stops_and_open_fusuma_passes_test() {
  let g = the_grid()
  step(set.new(), Cell(18, 15), Cell(24, 15)) |> should.equal(Cell(20, 15))
  step(grid.fusuma(g), Cell(18, 15), Cell(24, 15)) |> should.equal(Cell(24, 15))
}

/// いつも開いている戸（洗面所-東の廊下の片開き戸、広縁-縁側の掃き出し窓）は、襖が全部
/// 閉じていても通れる。
pub fn always_open_doors_pass_test() {
  step(set.new(), Cell(34, 10), Cell(34, 16)) |> should.equal(Cell(34, 16))
  step(set.new(), Cell(2, 15), Cell(6, 15)) |> should.equal(Cell(6, 15))
}

/// いつも閉じている戸（玄関の戸・勝手口）からは、外へ出られない。
pub fn always_closed_doors_stop_test() {
  let g = the_grid()
  step(grid.fusuma(g), Cell(35, 39), Cell(35, 43)) |> should.equal(Cell(35, 40))
  step(grid.fusuma(g), Cell(22, 3), Cell(22, -2)) |> should.equal(Cell(22, 1))
}

/// 縁側から庭へは出られない（北の端・南の端・東の端）。掃き出し窓の無い所では、縁側と広縁の
/// 間も壁。
pub fn engawa_does_not_lead_to_the_garden_test() {
  let g = the_grid()
  let open = grid.fusuma(g)
  step(open, Cell(1, 8), Cell(1, 2)) |> should.equal(Cell(1, 6))
  step(open, Cell(10, 42), Cell(10, 48)) |> should.equal(Cell(10, 44))
  step(open, Cell(15, 42), Cell(25, 42)) |> should.equal(Cell(20, 42))
  step(open, Cell(2, 7), Cell(6, 7)) |> should.equal(Cell(3, 7))
  // 縁側と庭の境は、どれも通れない。
  list.each(walkable_cells(), fn(cell) {
    case char_at(cell) {
      "=" ->
        list.each(neighbors(cell), fn(n) {
          case char_at(n) {
            "~" -> grid.passable(g, open, cell, n) |> should.be_false
            _ -> Nil
          }
        })
      _ -> Nil
    }
  })
  // 戸の辺はどれも、地図の中の歩けるマスどうしか、外（"~"）へのいつも閉じている戸。
  list.each(hiraya.doors, fn(door) {
    list.each(hiraya.edges(door), fn(edge) {
      case char_at(edge.a) == "~" || char_at(edge.b) == "~" {
        True -> door.kind |> should.equal(grid.AlwaysClosed)
        False -> Nil
      }
    })
  })
}

/// 地図の文字と、領域の名前の対応（通知の regions と同じ）が、歩けるマスの領域になっている。
pub fn regions_of_cells_follow_the_symbols_test() {
  let g = the_grid()
  let names = dict.from_list(hiraya.regions)
  list.each(walkable_cells(), fn(cell) {
    dict.get(g.regions, cell) |> should.equal(dict.get(names, char_at(cell)))
  })
}

// --- 共有の見本 ---------------------------------------------------------

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn fixture() -> Dynamic {
  let assert Ok(bytes) =
    read_file("../packages/contracts/src/fixtures/veryare-hiraya-stage.json")
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

fn point_at(value: Dynamic, key: String) -> #(Float, Float) {
  let number =
    decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
  let assert Ok(p) =
    decode.run(
      value,
      decode.at([key], {
        use x <- decode.field("x", number)
        use z <- decode.field("z", number)
        decode.success(#(x, z))
      }),
    )
  p
}

/// 見本のステージの通知は、サーバーの平屋のデータ（hiraya.grid と、送る通知）と一致する。
pub fn hiraya_fixture_matches_the_server_test() {
  let assert Ok(stage) =
    decode.run(fixture(), decode.at(["stage"], decode.dynamic))
  let assert Ok(from_fixture) = stage_notice.decode(stage)
  let g = the_grid()
  from_fixture.grid |> should.equal(grid.Grid(..g, groups: dict.new()))
  from_fixture.spawn |> should.equal(hiraya.spawn)
  from_fixture.rooms |> should.equal(dict.from_list(hiraya.rooms))
  // サーバーが送る通知を JSON の文字列を経て読み戻しても、見本と同じになる。
  let text = hiraya.notice() |> message.json_of_dynamic |> json.to_string
  let assert Ok(sent) = json.parse(text, decode.dynamic)
  stage_notice.decode(sent) |> should.equal(Ok(from_fixture))
}

/// 見本の移動の例は、サーバーの移動の規則（grid.step）のとおりに止まる。
pub fn hiraya_fixture_cases_follow_grid_step_test() {
  let assert Ok(cases) =
    decode.run(fixture(), decode.at(["cases"], decode.list(decode.dynamic)))
  { list.length(cases) >= 8 } |> should.be_true
  let g = the_grid()
  list.each(cases, fn(case_) {
    let assert Ok(fusuma) =
      decode.run(case_, decode.at(["fusuma"], decode.string))
    let open = case fusuma {
      "open" -> grid.fusuma(g)
      _ -> set.new()
    }
    let #(x, z) =
      grid.step(g, open, point_at(case_, "from"), point_at(case_, "to"))
    let #(ex, ez) = point_at(case_, "expect")
    close(x, ex, 1.0e-6) |> should.be_true
    close(z, ez, 1.0e-6) |> should.be_true
  })
}
