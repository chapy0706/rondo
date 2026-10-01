/// veryare のステージ構成（ADR 0032）。廊下骨格10種と、部屋スロットへの部屋タイプの割り当て。
///
/// 骨格は skeleton_maps.gleam の文字地図（1文字 = 1m 四方）を読み込んだ純粋なデータで、
/// 見た目（3D・襖の開閉）は持たない（issue-29）。部屋の出入り口（襖）は廊下に面した
/// スロットにだけあり、部屋同士を直接つなぐ襖はない。廊下は人が設計した、必ずつながった
/// 形なので、到達可能性を保証する生成アルゴリズムは要らない。
///
/// 割り当ては種（seed）から決まる純粋関数で、同じ種なら同じ結果になる。ゲーム開始時に
/// 乱数で種を1つ引いて使う。
import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/set
import gleam/string
import rondo_server/games/veryare/skeleton_maps

// --- 型 ------------------------------------------------------------------

/// 1m 四方のマス。x は幅方向、z は奥（0）から手前（玄関側）への方向。
pub type Cell {
  Cell(x: Int, z: Int)
}

/// スロットの大きさ。大は 4m x 6m（和室系）、小は 2m x 1m（独立した押し入れ）。
pub type SlotSize {
  Large
  Small
}

/// 襖。廊下のマスと、そこに接するスロットのマスの境にある。
pub type Door {
  Door(corridor: Cell, slot: Cell)
}

/// 部屋を置ける区画。位置は骨格に固定で、中身（部屋タイプ）だけが毎回変わる。
pub type Slot {
  Slot(id: String, size: SlotSize, cells: List(Cell), doors: List(Door))
}

/// 見えない壁。縁側のマス（inside）と庭のマス（outside）の境で、ここから外へは出られない。
pub type Wall {
  Wall(inside: Cell, outside: Cell)
}

pub type Skeleton {
  Skeleton(
    /// 骨格の番号（1〜10）。
    id: Int,
    width: Int,
    depth: Int,
    /// 廊下（襖のある廊下を含む）。
    corridor: List(Cell),
    /// 歩ける場所すべて（廊下・縁側・玄関）。
    walkable: List(Cell),
    slots: List(Slot),
    /// 縁側（隠れられる）。
    engawa: List(Cell),
    /// 縁側の外周（庭側）の、出られない境界の印。壁の配置そのものは issue-29。
    invisible_walls: List(Wall),
    /// 玄関（骨格ごとに固定）。
    entrance: List(Cell),
    /// 鬼と隠れ側の初期リスポーン位置（玄関の中心、メートル）。処理そのものは issue-29。
    spawn: #(Float, Float),
  )
}

/// 部屋タイプ。掛け軸エリアは見た目だけの装飾で、隠れる機能や別の当たり判定は持たず、
/// 部屋全体の一部として扱う。部屋内包の押し入れ・掛け軸エリアは部屋の中からだけ入れ、
/// 廊下側の襖はスロットの襖1つだけ。
pub type RoomType {
  /// 和室単体（大スロット）。
  Washitsu
  /// 和室＋押し入れ（押し入れは部屋の内側から入る。大スロット）。
  WashitsuWithOshiire
  /// 和室＋掛け軸エリア（見た目だけ。大スロット）。
  WashitsuWithKakejiku
  /// 押し入れ単体（廊下に直接面した独立の押し入れ。小スロット）。
  Oshiire
}

/// 1回のゲームのステージ。rooms に無いスロットは空き（廊下だけの区画）。
pub type Layout {
  Layout(skeleton: Skeleton, rooms: Dict(String, RoomType))
}

// --- 構成の幅（ADR 0032） ------------------------------------------------------

const min_washitsu = 8

const max_washitsu = 12

/// 「押し入れ4前後」を 3〜5 とする（部屋内包と独立の合計）。
const min_oshiire = 3

const max_oshiire = 5

// --- 骨格の読み込み -------------------------------------------------------------

/// 10種の骨格。
pub fn skeletons() -> List(Skeleton) {
  list.index_map(skeleton_maps.maps, fn(rows, index) { parse(index + 1, rows) })
}

fn parse(id: Int, rows: List(String)) -> Skeleton {
  let cells =
    rows
    |> list.index_map(fn(row, z) {
      row
      |> string.to_graphemes
      |> list.index_map(fn(char, x) { #(Cell(x, z), char) })
    })
    |> list.flatten
  let grid = dict.from_list(cells)
  let of = fn(chars: List(String)) {
    list.filter_map(cells, fn(entry) {
      case list.contains(chars, entry.1) {
        True -> Ok(entry.0)
        False -> Error(Nil)
      }
    })
  }

  let corridor = of([".", "+"])
  let door_cells = of(["+"])
  let engawa = of(["="])
  let entrance = of(["@"])

  let slots =
    cells
    |> list.filter(fn(entry) { is_slot(entry.1) })
    |> list.group(fn(entry) { entry.1 })
    |> dict.to_list
    |> list.sort(fn(a, b) { string.compare(a.0, b.0) })
    |> list.map(fn(group) {
      let #(letter, entries) = group
      let slot_cells = list.map(entries, fn(entry) { entry.0 })
      Slot(
        id: letter,
        size: case string.uppercase(letter) == letter {
          True -> Large
          False -> Small
        },
        cells: slot_cells,
        doors: doors_of(slot_cells, door_cells),
      )
    })

  let invisible_walls =
    list.flat_map(engawa, fn(cell) {
      list.filter_map(neighbours(cell), fn(next) {
        case dict.get(grid, next) {
          Ok("~") -> Ok(Wall(inside: cell, outside: next))
          _ -> Error(Nil)
        }
      })
    })

  Skeleton(
    id:,
    width: case rows {
      [first, ..] -> string.length(first)
      [] -> 0
    },
    depth: list.length(rows),
    corridor:,
    walkable: list.flatten([corridor, engawa, entrance]),
    slots:,
    engawa:,
    invisible_walls:,
    entrance:,
    spawn: center_of(entrance),
  )
}

fn is_slot(char: String) -> Bool {
  string.uppercase(char) != string.lowercase(char)
}

/// スロットに接する襖。襖のマスごとに、接しているスロットのマスと組にする。
fn doors_of(slot_cells: List(Cell), door_cells: List(Cell)) -> List(Door) {
  list.filter_map(door_cells, fn(door) {
    case list.find(slot_cells, fn(cell) { adjacent(door, cell) }) {
      Ok(cell) -> Ok(Door(corridor: door, slot: cell))
      Error(Nil) -> Error(Nil)
    }
  })
}

fn center_of(cells: List(Cell)) -> #(Float, Float) {
  let count = int.to_float(int.max(list.length(cells), 1))
  let sum_x = list.fold(cells, 0, fn(acc, c) { acc + c.x })
  let sum_z = list.fold(cells, 0, fn(acc, c) { acc + c.z })
  // マスの中心は +0.5m。
  #(int.to_float(sum_x) /. count +. 0.5, int.to_float(sum_z) /. count +. 0.5)
}

// --- 形の問い合わせ ---------------------------------------------------------------

fn neighbours(cell: Cell) -> List(Cell) {
  [
    Cell(cell.x + 1, cell.z),
    Cell(cell.x - 1, cell.z),
    Cell(cell.x, cell.z + 1),
    Cell(cell.x, cell.z - 1),
  ]
}

/// 上下左右で隣り合うか。
pub fn adjacent(a: Cell, b: Cell) -> Bool {
  int.absolute_value(a.x - b.x) + int.absolute_value(a.z - b.z) == 1
}

/// マスの集まりが、上下左右のつながりで1つにまとまっているか。
pub fn is_connected(cells: List(Cell)) -> Bool {
  case cells {
    [] -> True
    [first, ..] -> {
      let all = set.from_list(cells)
      set.size(flood(all, [first], set.from_list([first]))) == set.size(all)
    }
  }
}

fn flood(all: set.Set(Cell), stack: List(Cell), seen: set.Set(Cell)) {
  case stack {
    [] -> seen
    [cell, ..rest] -> {
      let next =
        list.filter(neighbours(cell), fn(n) {
          set.contains(all, n) && !set.contains(seen, n)
        })
      flood(
        all,
        list.append(next, rest),
        list.fold(next, seen, fn(acc, n) { set.insert(acc, n) }),
      )
    }
  }
}

// --- 割り当て ----------------------------------------------------------------

/// 骨格を1つ選び、部屋タイプを割り当てる。同じ種なら同じ結果。
pub fn generate(seed: Int) -> Layout {
  let all = skeletons()
  let #(index, seed) = draw(normalize(seed), list.length(all))
  let assert Ok(skeleton) = all |> list.drop(index) |> list.first
  Layout(skeleton:, rooms: assign(skeleton, seed))
}

/// スロットへ部屋タイプを割り当てる。空きのスロットも残し、構成の幅
/// （和室8〜12・押し入れ3〜5）に必ず収める。
fn assign(skeleton: Skeleton, seed: Int) -> Dict(String, RoomType) {
  let large = slot_ids(skeleton, Large)
  let small = slot_ids(skeleton, Small)
  let large_count = list.length(large)
  let small_count = list.length(small)

  // 和室の数
  let most = int.min(max_washitsu, large_count)
  let #(extra, seed) = draw(seed, most - min_washitsu + 1)
  let washitsu = min_washitsu + extra
  // 押し入れの総数（部屋内包＋独立）
  let #(extra, seed) = draw(seed, max_oshiire - min_oshiire + 1)
  let oshiire = int.min(min_oshiire + extra, washitsu + small_count)
  // そのうち独立した押し入れの数
  let fewest = int.max(0, oshiire - washitsu)
  let #(extra, seed) = draw(seed, int.min(small_count, oshiire) - fewest + 1)
  let standalone = fewest + extra
  let inner = oshiire - standalone

  let #(large, seed) = shuffle(large, seed)
  let #(small, seed) = shuffle(small, seed)
  let rooms_large = list.take(large, washitsu)
  let #(with_oshiire, plain) = #(
    list.take(rooms_large, inner),
    list.drop(rooms_large, inner),
  )

  let #(plain_rooms, _seed) =
    list.fold(plain, #([], seed), fn(acc, id) {
      let #(rooms, seed) = acc
      let #(kind, seed) = draw(seed, 2)
      let room = case kind {
        0 -> Washitsu
        _ -> WashitsuWithKakejiku
      }
      #([#(id, room), ..rooms], seed)
    })

  list.flatten([
    list.map(with_oshiire, fn(id) { #(id, WashitsuWithOshiire) }),
    plain_rooms,
    list.map(list.take(small, standalone), fn(id) { #(id, Oshiire) }),
  ])
  |> dict.from_list
}

fn slot_ids(skeleton: Skeleton, size: SlotSize) -> List(String) {
  skeleton.slots
  |> list.filter(fn(slot) { slot.size == size })
  |> list.map(fn(slot) { slot.id })
}

/// 和室の数（和室単体・押し入れ付き・掛け軸付き）。
pub fn washitsu_count(layout: Layout) -> Int {
  dict.values(layout.rooms)
  |> list.count(fn(room) { room != Oshiire })
}

/// 押し入れの数（部屋内包と独立の合計）。
pub fn oshiire_count(layout: Layout) -> Int {
  dict.values(layout.rooms)
  |> list.count(fn(room) { room == WashitsuWithOshiire || room == Oshiire })
}

// --- 種からの乱数（線形合同法） ----------------------------------------------------

const modulus = 2_147_483_648

fn normalize(seed: Int) -> Int {
  int.absolute_value(seed) % modulus
}

/// 0 以上 size 未満の値と、次の種を返す。
fn draw(seed: Int, size: Int) -> #(Int, Int) {
  let next = { seed * 1_103_515_245 + 12_345 } % modulus
  case size <= 1 {
    True -> #(0, next)
    False -> #({ next / 65_536 } % size, next)
  }
}

/// 種で並べ替える（Fisher-Yates）。
fn shuffle(items: List(a), seed: Int) -> #(List(a), Int) {
  do_shuffle(items, [], seed)
}

fn do_shuffle(rest: List(a), acc: List(a), seed: Int) -> #(List(a), Int) {
  case rest {
    [] -> #(acc, seed)
    _ -> {
      let #(index, seed) = draw(seed, list.length(rest))
      let picked = rest |> list.drop(index) |> list.first
      case picked {
        Ok(item) -> {
          let remaining =
            list.append(list.take(rest, index), list.drop(rest, index + 1))
          do_shuffle(remaining, [item, ..acc], seed)
        }
        Error(Nil) -> #(acc, seed)
      }
    }
  }
}
