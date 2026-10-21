//// 観戦用の通知の形（issue-67 / ADR 0009）。TS の契約の見本（packages/contracts/src/fixtures/
//// veryare-spectate.json）を読み、サーバーの読み取りが valid をすべて受け付け、invalid をすべて拒む
//// ことを確かめる。TS 側は、同じ JSON の valid が TS の型で書いた見本と一致することを確かめている。
//// サーバーが送る通知は、JSON を経て、そのまま読み戻せる。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/spectate_notice.{Actor, Look}
import rondo_server/protocol/message

const fixture_path = "../packages/contracts/src/fixtures/veryare-spectate.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(kind: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(
      text,
      decode.at(["spectateNotice", kind], decode.list(decode.dynamic)),
    )
  list
}

/// valid はすべて読め、invalid はすべて拒む。
pub fn spectate_notice_samples_test() {
  samples("valid")
  |> list.map(fn(sample) {
    let assert Ok(notice) = spectate_notice.decode_notice(sample)
    notice
  })
  |> should.equal([
    #([], None),
    #(
      [
        Actor("cpu-2", 4.25, 10.5, 1.57, "walking"),
        Actor("cpu-1", 2.0, -0.5, -3.14, "standing"),
      ],
      None,
    ),
    #(
      [Actor("cpu-2", 8.5, 10.5, 0.68, "lying")],
      Some([
        Look("cpu-2", "lying", "#c2b280"),
        Look("cpu-3", "crouching", "#a8956a"),
      ]),
    ),
  ])
  let invalid = samples("invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    spectate_notice.decode_notice(sample) |> should.be_error
  })
}

/// サーバーが送る観戦用の通知は、そのまま読み戻せる（JSON を経ても同じ）。
pub fn server_spectate_notice_round_trips_test() {
  let actors = [
    Actor("cpu-2", 4.25, 10.5, 1.57, "walking"),
    Actor("cpu-1", 2.0, -0.5, -3.14, "standing"),
  ]
  let looks = [Look("cpu-2", "lying", "#c2b280")]
  list.each([None, Some(looks)], fn(chosen) {
    let text =
      spectate_notice.payload(actors, chosen)
      |> message.json_of_dynamic
      |> json.to_string
    let assert Ok(value) = json.parse(text, decode.dynamic)
    spectate_notice.decode_notice(value) |> should.equal(Ok(#(actors, chosen)))
  })
}
