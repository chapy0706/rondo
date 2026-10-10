/// 人間のペイント（issue-25）の検証。共有の見本（packages/contracts/src/fixtures/veryare-paint.json）を
/// TS と同じく通す（ADR 0009）。
import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleeunit/should
import rondo_server/games/veryare/paint
import rondo_server/protocol/message

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn fixture() -> Dynamic {
  let assert Ok(bytes) =
    read_file("../packages/contracts/src/fixtures/veryare-paint.json")
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

fn over_the_wire(payload: Dynamic) -> Dynamic {
  let text = payload |> message.json_of_dynamic |> json.to_string
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

/// 上限の見本（limits）は、サーバーの定数と同じ。
pub fn limits_match_the_fixture_test() {
  let limits = at(fixture(), ["limits"])
  let int = fn(name) {
    let assert Ok(value) = decode.run(limits, decode.at([name], decode.int))
    value
  }
  let float = fn(name) {
    let assert Ok(value) = decode.run(limits, decode.at([name], decode.float))
    value
  }
  int("maxStrokes") |> should.equal(paint.max_strokes)
  int("maxPoints") |> should.equal(paint.max_points)
  float("minSize") |> should.equal(paint.min_size)
  float("maxSize") |> should.equal(paint.max_size)
}

/// 見本の valid はすべて受け付け、invalid はすべて拒む。
pub fn fixture_samples_test() {
  list.each(items(at(fixture(), ["valid"])), fn(sample) {
    decode.run(sample, paint.event_decoder()) |> should.be_ok
  })
  list.each(items(at(fixture(), ["invalid"])), fn(sample) {
    decode.run(sample, paint.event_decoder()) |> should.be_error
  })
}

fn point() -> Dynamic {
  dynamic.properties([
    #(dynamic.string("u"), dynamic.float(0.5)),
    #(dynamic.string("v"), dynamic.float(0.5)),
  ])
}

fn stroke(points: Int) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("part"), dynamic.string("torso")),
    #(dynamic.string("color"), dynamic.string("#a07850")),
    #(dynamic.string("size"), dynamic.float(0.04)),
    #(dynamic.string("points"), dynamic.list(list.repeat(point(), points))),
  ])
}

fn event(strokes: List(Dynamic)) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("paint")),
    #(
      dynamic.string("paint"),
      dynamic.properties([
        #(dynamic.string("kind"), dynamic.string("strokes")),
        #(dynamic.string("strokes"), dynamic.list(strokes)),
      ]),
    ),
  ])
}

/// ストロークの本数は上限ちょうどまで受け付け、1本超えると丸ごと捨てる。
pub fn stroke_count_limit_test() {
  decode.run(
    event(list.repeat(stroke(1), paint.max_strokes)),
    paint.event_decoder(),
  )
  |> should.be_ok
  decode.run(
    event(list.repeat(stroke(1), paint.max_strokes + 1)),
    paint.event_decoder(),
  )
  |> should.be_error
}

/// 点の数（全ストロークの合計）は上限ちょうどまで受け付け、1点超えると丸ごと捨てる。
pub fn point_count_limit_test() {
  decode.run(
    event([stroke(paint.max_points - 1), stroke(1)]),
    paint.event_decoder(),
  )
  |> should.be_ok
  decode.run(
    event([stroke(paint.max_points), stroke(1)]),
    paint.event_decoder(),
  )
  |> should.be_error
}

/// サーバーが一括配信に載せるペイントは、受け取ったペイントと同じ形（見本の hiders と同じ）。
pub fn payload_round_trips_test() {
  let fixture = fixture()
  let assert [_, sample] = items(at(fixture, ["valid"]))
  let assert Ok(strokes) = decode.run(sample, paint.event_decoder())
  let sent = over_the_wire(paint.payload(strokes))
  let assert [hider] = items(at(fixture, ["hiders", "hiders"]))
  decode.run(sent, paint.paint_decoder())
  |> should.equal(decode.run(at(hider, ["paint"]), paint.paint_decoder()))
  decode.run(sent, decode.at(["kind"], decode.string))
  |> should.equal(Ok("strokes"))
}
