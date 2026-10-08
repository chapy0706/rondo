//// 射撃の申告の形（issue-27 / ADR 0009）。TS の契約の見本
//// （packages/contracts/src/fixtures/veryare-events.json）を読み、サーバーの decoder が
//// valid をすべて受け付け、invalid をすべて拒むことを確かめる。TS 側は、同じ JSON の valid が
//// TS の型で書いた見本と一致することを確かめている。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/room
import rondo_server/room/room_actor.{PlayerId}

const fixture_path = "../packages/contracts/src/fixtures/veryare-events.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(kind: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(text, decode.at(["shoot", kind], decode.list(decode.dynamic)))
  list
}

/// valid の見本は、すべて受け付ける。狙いは文字列なら Some、null なら None。
pub fn valid_shoot_samples_are_accepted_test() {
  samples("valid")
  |> list.map(fn(sample) {
    let assert Ok(target) = decode.run(sample, room.shoot_decoder())
    target
  })
  |> should.equal([Some(PlayerId("p-2")), None])
}

/// invalid の見本は、すべて拒む（ゲームには渡らない）。
pub fn invalid_shoot_samples_are_rejected_test() {
  let invalid = samples("invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    decode.run(sample, room.shoot_decoder()) |> should.be_error
  })
}
