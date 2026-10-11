/// 固定ステージ「平屋」のデータ（issue-44 / ADR 0039）。docs/stage-hiraya-proposal.md の文字地図と
/// 戸の一覧を書き起こしたもの。素材（glb）ではなく、素材の位置を写した設計のデータなので、
/// リポジトリに入れる。
///
/// 移動の規則（grid / issue-29a）と襖の状態（issue-29b）は、すべてのステージで共通のまま使う。
/// 平屋で違うのはデータだけ（1マス 0.3 m・原点・3種類の戸・リスポーン位置）。クライアントへは、
/// ステージの通知でこのデータそのものを送る（ADR 0042。クライアントは写しを持たない）。
///
/// 座標は glb の座標（x, z、メートル）をそのまま使う。列 c のマスは x = −6.225 + 0.3c 〜 +0.3、
/// 行 r のマスは z = −0.275 + 0.3r 〜 +0.3。
///
/// 見通しと CPU は、issue-45 まで平屋では使わない（ルームの設定で CPU を拒み、射撃は当てない）。
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/int
import gleam/list
import gleam/string
import rondo_server/games/veryare/grid.{
  type DoorKind, type Edge, type Grid, AlwaysClosed, AlwaysOpen, Fusuma, Grid,
}
import rondo_server/games/veryare/stage.{type Cell, Cell}
import rondo_server/games/veryare/stage_notice

/// 1マスの大きさ（メートル）。
pub const cell_size = 0.3

/// 列 0・行 0 のマスの角（x, z）。
pub const origin = #(-6.225, -0.275)

pub const width = 41

pub const depth = 45

/// 玄関の土間のリスポーン位置（x, z）。鬼（探索の開始）と隠れ側（準備移動の開始）が現れる。
pub const spawn = #(4.7, 11.3)

/// 文字地図。行が z（0 が北）、列が x。記号の意味は regions。
pub const rows = [
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~::::oooooooooooooKKKKKKKKKKKKFFFFFFF~",
  "~~~~::::oooooooooooooKKKKKKKKKKKKFFFFFFF~",
  "~~~~::::oooooooooooooKKKKKKKKKKKKFFFFFFF~",
  "~~~~::::oooooooooooooKKKKKKKKKKKKFFFFFFF~",
  "~~~~::::oooooooooooooKKKKKKKKKKKKFFFFFFF~",
  "====::::AAAAAAAAAAAAAKKKKKKKKKKKKFFFFFFF~",
  "====::::AAAAAAAAAAAAAKKKKKKKKKKKKWWWWWWW~",
  "====::::AAAAAAAAAAAAAKKKKKKKKKKKKWWWWWWW~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDDWWWWWWW~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDDWWWWWWW~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDDWWWWWWW~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDDWWWWWWW~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD...TTTT~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD.......~",
  "====::::AAAAAAAAAAAAADDDDDDDDDDDD.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====::::BBBBBBBBBBBBBCCCCCCCCCCCC.......~",
  "====:::::::::::::::::::::::::::::@@@@@@@~",
  "====:::::::::::::::::::::::::::::@@@@@@@~",
  "====:::::::::::::::::::::::::::::@@@@@@@~",
  "====:::::::::::::::::::::::::::::@@@@@@@~",
  "====:::::::::::::::::::::::::::::@@@@@@@~",
  "=====================~~~~~~~~~~~~~~~~~~~~",
  "=====================~~~~~~~~~~~~~~~~~~~~",
  "=====================~~~~~~~~~~~~~~~~~~~~",
  "=====================~~~~~~~~~~~~~~~~~~~~",
]

/// 記号 → 領域の名前。歩ける記号だけを載せる（"~" の庭・建物の外は歩けない）。領域の名前は
/// 記号そのもの（記号ごとに別の領域。東の廊下と玄関、広縁と縁側の間にも戸があるため）。
///
/// "=" 縁側（外のデッキ）、":" 広縁、"." 東の廊下、"@" 玄関（土間。隠れ場所に数えない）、
/// "A" "B" "C" 和室（B は床の間を含む）、"D" ダイニング、"K" キッチン、"F" 風呂、"W" 洗面所、
/// "T" トイレ、"o" 押入れ。
pub const regions = [
  #("=", "="),
  #(":", ":"),
  #(".", "."),
  #("@", "@"),
  #("A", "A"),
  #("B", "B"),
  #("C", "C"),
  #("D", "D"),
  #("K", "K"),
  #("F", "F"),
  #("W", "W"),
  #("T", "T"),
  #("o", "o"),
]

/// 部屋のスロットの領域 → 部屋タイプの名前（見た目の色分けに使う。ステージの通知の rooms）。
pub const rooms = [
  #("A", "washitsu"),
  #("B", "washitsu-kakejiku"),
  #("C", "washitsu"),
  #("D", "dining"),
  #("K", "kitchen"),
  #("F", "bath"),
  #("W", "washroom"),
  #("T", "toilet"),
  #("o", "oshiire"),
]

/// 戸。境をはさむマスの組の、両端（first と last）を書き、間は境に沿って連続する。
pub type Door {
  Door(name: String, kind: DoorKind, first: #(Cell, Cell), last: #(Cell, Cell))
}

/// 戸の一覧（20 個: 襖 10、いつも開いている 8、いつも閉じている 2）。提案書の表のとおり。
pub const doors = [
  Door(
    name: "押入れ 2枚戸 西",
    kind: Fusuma,
    first: #(Cell(8, 5), Cell(8, 6)),
    last: #(Cell(13, 5), Cell(13, 6)),
  ),
  Door(
    name: "押入れ 2枚戸 東",
    kind: Fusuma,
    first: #(Cell(14, 5), Cell(14, 6)),
    last: #(Cell(19, 5), Cell(19, 6)),
  ),
  Door(
    name: "和室A-ダイニング 4枚戸",
    kind: Fusuma,
    first: #(Cell(20, 9), Cell(21, 9)),
    last: #(Cell(20, 20), Cell(21, 20)),
  ),
  Door(
    name: "和室B-和室C 4枚戸",
    kind: Fusuma,
    first: #(Cell(20, 24), Cell(21, 24)),
    last: #(Cell(20, 35), Cell(21, 35)),
  ),
  Door(
    name: "和室C-ダイニング 4枚戸",
    kind: Fusuma,
    first: #(Cell(21, 20), Cell(21, 21)),
    last: #(Cell(32, 20), Cell(32, 21)),
  ),
  Door(
    name: "和室C-東の廊下 4枚戸",
    kind: Fusuma,
    first: #(Cell(32, 24), Cell(33, 24)),
    last: #(Cell(32, 35), Cell(33, 35)),
  ),
  Door(
    name: "和室A-広縁 障子",
    kind: Fusuma,
    first: #(Cell(7, 9), Cell(8, 9)),
    last: #(Cell(7, 20), Cell(8, 20)),
  ),
  Door(
    name: "和室B-広縁 障子（西）",
    kind: Fusuma,
    first: #(Cell(7, 24), Cell(8, 24)),
    last: #(Cell(7, 35), Cell(8, 35)),
  ),
  Door(
    name: "和室B-広縁 障子（南）",
    kind: Fusuma,
    first: #(Cell(8, 35), Cell(8, 36)),
    last: #(Cell(19, 35), Cell(19, 36)),
  ),
  Door(
    name: "和室C-広縁 障子（南）",
    kind: Fusuma,
    first: #(Cell(21, 35), Cell(21, 36)),
    last: #(Cell(32, 35), Cell(32, 36)),
  ),
  Door(
    name: "風呂-洗面所 片開き戸",
    kind: AlwaysOpen,
    first: #(Cell(33, 6), Cell(33, 7)),
    last: #(Cell(35, 6), Cell(35, 7)),
  ),
  Door(
    name: "洗面所-東の廊下 片開き戸",
    kind: AlwaysOpen,
    first: #(Cell(33, 12), Cell(33, 13)),
    last: #(Cell(35, 12), Cell(35, 13)),
  ),
  Door(
    name: "トイレ-東の廊下 片開き戸",
    kind: AlwaysOpen,
    first: #(Cell(37, 18), Cell(37, 19)),
    last: #(Cell(39, 18), Cell(39, 19)),
  ),
  Door(
    name: "キッチン-ダイニング ガラス戸",
    kind: AlwaysOpen,
    first: #(Cell(21, 8), Cell(21, 9)),
    last: #(Cell(32, 8), Cell(32, 9)),
  ),
  Door(
    name: "東の廊下-玄関 通り抜け",
    kind: AlwaysOpen,
    first: #(Cell(33, 35), Cell(33, 36)),
    last: #(Cell(39, 35), Cell(39, 36)),
  ),
  Door(
    name: "広縁-縁側 掃き出し窓（西の北）",
    kind: AlwaysOpen,
    first: #(Cell(3, 9), Cell(4, 9)),
    last: #(Cell(3, 20), Cell(4, 20)),
  ),
  Door(
    name: "広縁-縁側 掃き出し窓（西の南）",
    kind: AlwaysOpen,
    first: #(Cell(3, 24), Cell(4, 24)),
    last: #(Cell(3, 35), Cell(4, 35)),
  ),
  Door(
    name: "広縁-縁側 掃き出し窓（南）",
    kind: AlwaysOpen,
    first: #(Cell(8, 40), Cell(8, 41)),
    last: #(Cell(19, 40), Cell(19, 41)),
  ),
  Door(
    name: "玄関 引違い戸（外へ）",
    kind: AlwaysClosed,
    first: #(Cell(33, 40), Cell(33, 41)),
    last: #(Cell(38, 40), Cell(38, 41)),
  ),
  Door(
    name: "キッチン 勝手口（外へ）",
    kind: AlwaysClosed,
    first: #(Cell(21, 0), Cell(21, 1)),
    last: #(Cell(23, 0), Cell(23, 1)),
  ),
]

/// 戸の境の辺すべて（first から last まで、境に沿って1マスずつ）。
pub fn edges(door: Door) -> List(Edge) {
  let #(a, b) = door.first
  let #(last_a, _) = door.last
  case a.x == b.x {
    // 上下に並ぶマスの境（z が一定の線）。x を進める。
    True ->
      through(a.x, last_a.x)
      |> list.map(fn(x) { grid.edge(Cell(x, a.z), Cell(x, b.z)) })
    // 左右に並ぶマスの境（x が一定の線）。z を進める。
    False ->
      through(a.z, last_a.z)
      |> list.map(fn(z) { grid.edge(Cell(a.x, z), Cell(b.x, z)) })
  }
}

/// from から to まで（両端を含み、from <= to）。
fn through(from: Int, to: Int) -> List(Int) {
  int.range(from:, to: to + 1, with: [], run: list.prepend) |> list.reverse
}

/// 移動の規則の入力。襖の組は、戸の一覧の並び順の番号。
pub fn grid() -> Grid {
  let names = dict.from_list(regions)
  let cells =
    rows
    |> list.index_map(fn(row, z) {
      row
      |> string.to_graphemes
      |> list.index_map(fn(char, x) { #(Cell(x, z), char) })
    })
    |> list.flatten
    |> list.filter_map(fn(entry) {
      case dict.get(names, entry.1) {
        Ok(region) -> Ok(#(entry.0, region))
        Error(Nil) -> Error(Nil)
      }
    })
  let numbered = list.index_map(doors, fn(door, index) { #(door, index) })
  Grid(
    cell_size:,
    origin:,
    width:,
    depth:,
    regions: dict.from_list(cells),
    doors: numbered
      |> list.flat_map(fn(entry) {
        list.map(edges(entry.0), fn(edge) { #(edge, entry.0.kind) })
      })
      |> dict.from_list,
    groups: numbered
      |> list.filter(fn(entry) { entry.0.kind == Fusuma })
      |> list.flat_map(fn(entry) {
        list.map(edges(entry.0), fn(edge) { #(edge, entry.1) })
      })
      |> dict.from_list,
  )
}

/// ステージの通知（issue-29a / ADR 0042）。契約の形は、骨格の通知と同じ。
pub fn notice() -> Dynamic {
  stage_notice.payload_of(
    cell_size:,
    origin:,
    width:,
    depth:,
    rows:,
    regions:,
    rooms:,
    doors: list.flat_map(doors, fn(door) {
      list.map(edges(door), fn(edge) { #(edge.a, edge.b, door.kind) })
    }),
    spawn:,
  )
}
