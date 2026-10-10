/// ステージの通知（issue-29a / ADR 0042）。選ばれたステージの地図のデータそのものを、
/// veryare の game-state の payload として送る（契約: VeryareStageNotice）。
///
/// クライアントは骨格の写しを持たず、この地図で表示し、サーバーと同じ移動の規則（grid）で
/// 動く。decode は、共有の見本（ADR 0009）と、送った通知を読み戻すテストに使う。
import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/result
import gleam/set.{type Set}
import gleam/string
import rondo_server/games/veryare/grid.{
  type DoorKind, type Edge, type Grid, AlwaysClosed, AlwaysOpen, Fusuma, Grid,
}
import rondo_server/games/veryare/skeleton_maps
import rondo_server/games/veryare/stage.{
  type Cell, type Layout, type RoomType, Cell, Oshiire, Washitsu,
  WashitsuWithKakejiku, WashitsuWithOshiire,
}

/// 読み戻した通知。
pub type Decoded {
  Decoded(grid: Grid, spawn: #(Float, Float), rooms: Dict(String, String))
}

// --- 送る ---------------------------------------------------------------------

/// 骨格（ADR 0032）のステージの通知。行は骨格の文字地図そのまま。廊下・縁側・玄関の文字は
/// 領域 "open"、部屋が割り当てられたスロットの文字は、そのスロットの領域。空きのスロット・
/// 壁・庭の文字は regions に載せない（歩けない）。戸は、割り当てられたスロットの襖。
pub fn payload(layout: Layout) -> Dynamic {
  let skeleton = layout.skeleton
  let rows = rows_of(skeleton.id)
  let open_chars = [".", "+", "=", "@"]
  let regions =
    list.append(
      list.map(open_chars, fn(char) { #(char, grid.open_region) }),
      layout.rooms |> dict.keys |> list.map(fn(slot) { #(slot, slot) }),
    )
  let doors =
    skeleton.slots
    |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
    |> list.flat_map(fn(slot) { slot.doors })
    |> list.map(fn(door) {
      dynamic.properties([
        #(dynamic.string("a"), cell(door.corridor)),
        #(dynamic.string("b"), cell(door.slot)),
        #(dynamic.string("kind"), dynamic.string(kind_name(Fusuma))),
      ])
    })
  let #(spawn_x, spawn_z) = skeleton.spawn
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("stage")),
    #(dynamic.string("cellSize"), dynamic.float(1.0)),
    #(dynamic.string("origin"), point(0.0, 0.0)),
    #(dynamic.string("width"), dynamic.int(skeleton.width)),
    #(dynamic.string("depth"), dynamic.int(skeleton.depth)),
    #(dynamic.string("rows"), dynamic.list(list.map(rows, dynamic.string))),
    #(dynamic.string("regions"), string_dict(regions)),
    #(
      dynamic.string("rooms"),
      string_dict(
        layout.rooms
        |> dict.to_list
        |> list.map(fn(entry) { #(entry.0, room_name(entry.1)) }),
      ),
    ),
    #(dynamic.string("doors"), dynamic.list(doors)),
    #(dynamic.string("spawn"), point(spawn_x, spawn_z)),
  ])
}

fn rows_of(skeleton_id: Int) -> List(String) {
  skeleton_maps.maps
  |> list.drop(skeleton_id - 1)
  |> list.first
  |> result.unwrap([])
}

fn cell(c: Cell) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("x"), dynamic.int(c.x)),
    #(dynamic.string("z"), dynamic.int(c.z)),
  ])
}

fn point(x: Float, z: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
  ])
}

fn string_dict(entries: List(#(String, String))) -> Dynamic {
  entries
  |> list.map(fn(entry) { #(dynamic.string(entry.0), dynamic.string(entry.1)) })
  |> dynamic.properties
}

/// 戸の種類の名前（契約: VeryareDoorKind）。
pub fn kind_name(kind: DoorKind) -> String {
  case kind {
    Fusuma -> "fusuma"
    AlwaysOpen -> "always-open"
    AlwaysClosed -> "always-closed"
  }
}

/// 部屋タイプの名前（見た目の色分けに使う）。
pub fn room_name(room: RoomType) -> String {
  case room {
    Washitsu -> "washitsu"
    WashitsuWithOshiire -> "washitsu-oshiire"
    WashitsuWithKakejiku -> "washitsu-kakejiku"
    Oshiire -> "oshiire"
  }
}

// --- 読む ---------------------------------------------------------------------

/// 通知を読む。形が違う・地図の大きさと行が食い違う・戸の種類が知らないもの・戸の2マスが
/// 隣り合わない、などは拒む（境での unknown の検証）。
pub fn decode(value: Dynamic) -> Result(Decoded, Nil) {
  use raw <- result.try(
    decode.run(value, notice_decoder()) |> result.replace_error(Nil),
  )
  let RawNotice(
    cell_size:,
    origin:,
    width:,
    depth:,
    rows:,
    regions:,
    rooms:,
    doors:,
    spawn:,
  ) = raw
  let rows_fit =
    list.length(rows) == depth
    && list.all(rows, fn(row) { string.length(row) == width })
  let doors_fit =
    list.all(doors, fn(door) {
      let #(a, b, _kind) = door
      int.absolute_value(a.x - b.x) + int.absolute_value(a.z - b.z) == 1
    })
  case cell_size >. 0.0 && width > 0 && depth > 0 && rows_fit && doors_fit {
    False -> Error(Nil)
    True -> {
      let cells =
        rows
        |> list.index_map(fn(row, z) {
          row
          |> string.to_graphemes
          |> list.index_map(fn(char, x) { #(Cell(x, z), char) })
        })
        |> list.flatten
        |> list.filter_map(fn(entry) {
          case dict.get(regions, entry.1) {
            Ok(region) -> Ok(#(entry.0, region))
            Error(Nil) -> Error(Nil)
          }
        })
      Ok(Decoded(
        grid: Grid(
          cell_size:,
          origin:,
          width:,
          depth:,
          regions: dict.from_list(cells),
          doors: doors
            |> list.map(fn(door) {
              let #(a, b, kind) = door
              #(grid.edge(a, b), kind)
            })
            |> dict.from_list,
        ),
        spawn:,
        rooms:,
      ))
    }
  }
}

type RawNotice {
  RawNotice(
    cell_size: Float,
    origin: #(Float, Float),
    width: Int,
    depth: Int,
    rows: List(String),
    regions: Dict(String, String),
    rooms: Dict(String, String),
    doors: List(#(Cell, Cell, DoorKind)),
    spawn: #(Float, Float),
  )
}

fn notice_decoder() -> decode.Decoder(RawNotice) {
  use kind <- decode.field("type", decode.string)
  use cell_size <- decode.field("cellSize", number())
  use origin <- decode.field("origin", point_decoder())
  use width <- decode.field("width", decode.int)
  use depth <- decode.field("depth", decode.int)
  use rows <- decode.field("rows", decode.list(decode.string))
  use regions <- decode.field(
    "regions",
    decode.dict(decode.string, decode.string),
  )
  use rooms <- decode.field("rooms", decode.dict(decode.string, decode.string))
  use doors <- decode.field("doors", decode.list(door_decoder()))
  use spawn <- decode.field("spawn", point_decoder())
  let raw =
    RawNotice(
      cell_size:,
      origin:,
      width:,
      depth:,
      rows:,
      regions:,
      rooms:,
      doors:,
      spawn:,
    )
  case kind {
    "stage" -> decode.success(raw)
    _ -> decode.failure(raw, "stage")
  }
}

fn door_decoder() -> decode.Decoder(#(Cell, Cell, DoorKind)) {
  use a <- decode.field("a", cell_decoder())
  use b <- decode.field("b", cell_decoder())
  use kind <- decode.field("kind", decode.string)
  case kind {
    "fusuma" -> decode.success(#(a, b, Fusuma))
    "always-open" -> decode.success(#(a, b, AlwaysOpen))
    "always-closed" -> decode.success(#(a, b, AlwaysClosed))
    _ -> decode.failure(#(a, b, Fusuma), "door kind")
  }
}

fn cell_decoder() -> decode.Decoder(Cell) {
  use x <- decode.field("x", decode.int)
  use z <- decode.field("z", decode.int)
  decode.success(Cell(x, z))
}

fn point_decoder() -> decode.Decoder(#(Float, Float)) {
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  decode.success(#(x, z))
}

/// 数（整数でも小数でもよい）。
fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
}

// --- 襖（issue-29b） ------------------------------------------------------------------

/// 境 {a, b}（契約: VeryareEdge）。
pub fn edge_payload(edge: Edge) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("a"), cell(edge.a)),
    #(dynamic.string("b"), cell(edge.b)),
  ])
}

/// 襖の通知 { type: "doors", open: [{a, b}] }（契約: VeryareDoorsNotice）。開いている襖の一覧。
pub fn doors_payload(open: Set(Edge)) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("doors")),
    #(
      dynamic.string("open"),
      open |> set.to_list |> list.map(edge_payload) |> dynamic.list,
    ),
  ])
}

/// 襖の通知を読む（共有の見本とテスト用）。
pub fn decode_doors(value: Dynamic) -> Result(Set(Edge), Nil) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use open <- decode.field("open", decode.list(edge_decoder()))
    case kind {
      "doors" -> decode.success(open)
      _ -> decode.failure([], "doors")
    }
  }
  decode.run(value, decoder)
  |> result.replace_error(Nil)
  |> result.try(fn(open) {
    case list.all(open, fn(e) { adjacent(e.a, e.b) }) {
      True -> Ok(set.from_list(open))
      False -> Error(Nil)
    }
  })
}

/// 襖を開ける報告 { type: "open-door", door: {a, b} }（契約: VeryareOpenDoorEvent）を読む。
/// 2マスが隣り合わなければ拒む（境での unknown の検証）。
pub fn open_door_decoder() -> decode.Decoder(Edge) {
  use kind <- decode.field("type", decode.string)
  use door <- decode.field("door", edge_decoder())
  case kind == "open-door" && adjacent(door.a, door.b) {
    True -> decode.success(door)
    False -> decode.failure(door, "open-door")
  }
}

fn edge_decoder() -> decode.Decoder(Edge) {
  use a <- decode.field("a", cell_decoder())
  use b <- decode.field("b", cell_decoder())
  decode.success(grid.edge(a, b))
}

fn adjacent(a: Cell, b: Cell) -> Bool {
  int.absolute_value(a.x - b.x) + int.absolute_value(a.z - b.z) == 1
}
