import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/room/room_name

/// TS と共有する見本（packages/contracts/src/fixtures/room-names.json）。
/// TS 側（packages/contracts/src/roomName.test.ts）も同じ見本を読む（issue-58）。
const fixture_path = "../packages/contracts/src/fixtures/room-names.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

type Case {
  Case(
    note: String,
    raw: option.Option(String),
    owner: String,
    expected: String,
  )
}

fn cases() -> List(Case) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let decoder = {
    use note <- decode.field("note", decode.string)
    use raw <- decode.field("raw", decode.optional(decode.string))
    use owner <- decode.field("owner", decode.string)
    use expected <- decode.field("expected", decode.string)
    decode.success(Case(note:, raw:, owner:, expected:))
  }
  let assert Ok(cases) = json.parse(text, decode.list(decoder))
  cases
}

/// 共有の見本どおりに整える（TS の normalizeRoomName と同じ結果）。
pub fn normalize_matches_shared_fixture_test() {
  list.each(cases(), fn(sample) {
    #(sample.note, room_name.normalize(sample.raw, sample.owner))
    |> should.equal(#(sample.note, sample.expected))
  })
}

/// 整えた名前は、どの見本でも 1〜20 文字（コードポイント）。
pub fn normalized_length_is_within_limit_test() {
  list.each(cases(), fn(sample) {
    let length =
      room_name.normalize(sample.raw, sample.owner)
      |> string.to_utf_codepoints
      |> list.length
    { length >= 1 && length <= room_name.max_length } |> should.be_true
  })
}

/// 省略と空は、どちらも既定の名前になる。
pub fn omitted_and_empty_become_default_test() {
  room_name.normalize(None, "user3") |> should.equal("user3のルーム")
  room_name.normalize(Some(""), "user3") |> should.equal("user3のルーム")
}
