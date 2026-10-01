import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/protocol/message

/// TS の契約の見本（packages/contracts/src/fixtures/messages.json）。
/// TS 側は同じ JSON が TS の型で書いた見本と一致することを確かめている（ADR 0009）。
const fixture_path = "../packages/contracts/src/fixtures/messages.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(side: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(text, decode.at([side], decode.list(decode.dynamic)))
  list
}

fn to_text(value: Dynamic) -> String {
  value |> message.json_of_dynamic |> json.to_string
}

fn reparse(text: String) -> Dynamic {
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

fn type_of(value: Dynamic) -> String {
  let assert Ok(kind) = decode.run(value, decode.at(["type"], decode.string))
  kind
}

// --- 契約との対応（ADR 0009） ---------------------------------------------------

/// クライアント→サーバーの全見本を decode でき、encode し直すと元の JSON と一致する。
pub fn every_client_sample_round_trips_test() {
  list.each(samples("client"), fn(sample) {
    let assert Ok(decoded) = message.decode_client(to_text(sample))
    reparse(message.encode_client(decoded)) |> should.equal(sample)
  })
}

/// サーバー→クライアントの全見本を decode でき、encode し直すと元の JSON と一致する。
pub fn every_server_sample_round_trips_test() {
  list.each(samples("server"), fn(sample) {
    let assert Ok(decoded) = message.decode_server(to_text(sample))
    reparse(message.encode_server(decoded)) |> should.equal(sample)
  })
}

/// Gleam 側の種別名の一覧は、契約の見本の種別と一致する（漏れも余りもない）。
pub fn message_type_names_match_the_contract_test() {
  samples("client")
  |> list.map(type_of)
  |> set.from_list
  |> should.equal(set.from_list(message.client_message_types))

  samples("server")
  |> list.map(type_of)
  |> set.from_list
  |> should.equal(set.from_list(message.server_message_types))
}

/// decode した電文の種別名は、元の JSON の type と一致する。
pub fn decoded_type_names_match_test() {
  list.each(samples("server"), fn(sample) {
    let assert Ok(decoded) = message.decode_server(to_text(sample))
    message.type_name(decoded) |> should.equal(type_of(sample))
  })
}

// --- 境界での検証 ----------------------------------------------------------------

/// 形の違う電文は拒否する（型の嘘を通さない）。
pub fn malformed_client_messages_are_rejected_test() {
  list.each(
    [
      "not json",
      "{}",
      "{\"type\":\"unknown\"}",
      "{\"type\":\"join-room\",\"gameType\":\"veryare\"}",
      "{\"type\":\"join-room\",\"gameType\":1,\"roomId\":\"r\"}",
      "{\"type\":\"set-name\",\"playerId\":\"p\"}",
    ],
    fn(text) { message.decode_client(text) |> should.be_error },
  )
}

/// create-room の settings は省略できる。
pub fn create_room_settings_are_optional_test() {
  let assert Ok(message.CreateRoom(game_type: "tilt-maze", settings:)) =
    message.decode_client(
      "{\"type\":\"create-room\",\"gameType\":\"tilt-maze\"}",
    )
  settings |> should.be_none
}

// --- ゲーム固有の payload（Dynamic）と JSON ------------------------------------------

/// Gleam で組み立てた payload（veryare の通知など）を JSON にできる。nil は null になる。
pub fn dynamic_payload_becomes_json_test() {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("phase")),
    #(dynamic.string("oni"), dynamic.nil()),
    #(dynamic.string("durationMs"), dynamic.int(10_000)),
    #(dynamic.string("ratio"), dynamic.float(0.5)),
    #(dynamic.string("ok"), dynamic.bool(True)),
    #(
      dynamic.string("items"),
      dynamic.list([dynamic.int(1), dynamic.string("a")]),
    ),
  ])
  |> message.json_of_dynamic
  |> json.to_string
  |> reparse
  |> should.equal(reparse(
    "{\"type\":\"phase\",\"oni\":null,\"durationMs\":10000,\"ratio\":0.5,\"ok\":true,\"items\":[1,\"a\"]}",
  ))
}
