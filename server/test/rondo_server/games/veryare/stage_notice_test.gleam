//// ステージの通知（issue-29a / ADR 0042）。地図のデータそのものを載せ、クライアントはこれだけで
//// 表示と移動ができる。TS の契約の見本（packages/contracts/src/fixtures/veryare-stage.json）と、
//// 移動の規則の共有の見本（veryare-movement.json）を読む（ADR 0009）。

import gleam/bit_array
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/json
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/stage_notice
import rondo_server/protocol/message

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn fixture(name: String) -> Dynamic {
  let assert Ok(bytes) =
    read_file("../packages/contracts/src/fixtures/" <> name <> ".json")
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

fn at(value: Dynamic, path: List(String)) -> Dynamic {
  let assert Ok(found) = decode.run(value, decode.at(path, decode.dynamic))
  found
}

fn items(value: Dynamic) -> List(Dynamic) {
  let assert Ok(list) = decode.run(value, decode.list(decode.dynamic))
  list
}

/// サーバーが送る payload を、JSON の文字列を経て Dynamic に戻す（通知が届いた形）。
fn over_the_wire(payload: Dynamic) -> Dynamic {
  let text = payload |> message.json_of_dynamic |> json.to_string
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

// --- 共有の見本 -------------------------------------------------------------------

/// valid の見本は、すべて読める。invalid の見本は、すべて拒む。
pub fn stage_fixture_valid_and_invalid_test() {
  let stage = fixture("veryare-stage")
  list.each(items(at(stage, ["valid"])), fn(sample) {
    stage_notice.decode(sample) |> should.be_ok
  })
  let invalid = items(at(stage, ["invalid"]))
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    stage_notice.decode(sample) |> should.be_error
  })
}

/// 見本の地図を読むと、マスの大きさ・原点・領域・戸・リスポーン位置がそのとおりになる。
pub fn stage_fixture_decodes_to_the_grid_test() {
  let assert [first, second] = items(at(fixture("veryare-stage"), ["valid"]))
  let assert Ok(decoded) = stage_notice.decode(first)
  let g = decoded.grid
  g.cell_size |> should.equal(1.0)
  g.origin |> should.equal(#(0.0, 0.0))
  grid.walkable(g, stage.Cell(4, 2)) |> should.be_true
  grid.walkable(g, stage.Cell(3, 0)) |> should.be_false
  dict.get(g.regions, stage.Cell(2, 0)) |> should.equal(Ok("A"))
  dict.get(g.doors, grid.edge(stage.Cell(1, 4), stage.Cell(2, 4)))
  |> should.equal(Ok(grid.AlwaysClosed))
  decoded.spawn |> should.equal(#(0.5, 4.5))
  let assert Ok(scaled) = stage_notice.decode(second)
  scaled.grid.cell_size |> should.equal(0.3)
  scaled.grid.origin |> should.equal(#(-6.225, -0.275))
}

/// 移動の規則の共有の見本を、すべて期待どおりに通す（TS 側は issue-29c で同じ見本を読む）。
pub fn movement_fixture_cases_test() {
  let movement = fixture("veryare-movement")
  let assert Ok(decoded) = stage_notice.decode(at(movement, ["stage"]))
  let point = fn(value: Dynamic) {
    let assert Ok(p) =
      decode.run(value, {
        use x <- decode.field("x", number())
        use z <- decode.field("z", number())
        decode.success(#(x, z))
      })
    p
  }
  list.each(items(at(movement, ["cases"])), fn(case_) {
    let open =
      items(at(case_, ["open"]))
      |> list.map(fn(edge) {
        let #(ax, az) = point(at(edge, ["a"]))
        let #(bx, bz) = point(at(edge, ["b"]))
        grid.edge(
          stage.Cell(float.truncate(ax), float.truncate(az)),
          stage.Cell(float.truncate(bx), float.truncate(bz)),
        )
      })
      |> set.from_list
    let actual =
      grid.step(
        decoded.grid,
        open,
        point(at(case_, ["from"])),
        point(at(case_, ["to"])),
      )
    let expected = point(at(case_, ["expect"]))
    let ok =
      float.absolute_value(actual.0 -. expected.0) <. 0.000001
      && float.absolute_value(actual.1 -. expected.1) <. 0.000001
    case ok {
      True -> Nil
      False -> {
        let assert Ok(name) =
          decode.run(case_, decode.at(["name"], decode.string))
        #(name, actual) |> should.equal(#(name, expected))
      }
    }
  })
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [
    decode.map(decode.int, fn(i) { int_to_float(i) }),
  ])
}

@external(erlang, "erlang", "float")
fn int_to_float(x: Int) -> Float

// --- サーバーが送る通知 --------------------------------------------------------------

/// 10種の骨格それぞれで、送る通知を読み戻すと、移動の規則の入力（of_layout）と玄関に一致する。
/// クライアントは、この通知だけで、サーバーと同じ地図を持てる。
pub fn notices_carry_the_same_grid_as_the_server_test() {
  list.each(stage.skeletons(), fn(skeleton) {
    let layout = stage.generate_on(skeleton, 3)
    let notice = over_the_wire(stage_notice.payload(layout))
    let assert Ok(decoded) = stage_notice.decode(notice)
    decoded.grid |> should.equal(grid.of_layout(layout))
    decoded.spawn |> should.equal(skeleton.spawn)
    // 部屋の割り当て（見た目の色分けに使う）も載る。
    let assert Ok(rooms) =
      decode.run(
        notice,
        decode.at(["rooms"], decode.dict(decode.string, decode.string)),
      )
    dict.size(rooms) |> should.equal(dict.size(layout.rooms))
  })
}
