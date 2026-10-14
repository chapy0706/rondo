//// 視界の報告・いいね・いいねの数の通知の形（issue-32 / ADR 0009）。TS の契約の見本
//// （packages/contracts/src/fixtures/veryare-missed.json）を読み、サーバーが valid をすべて受け付け、
//// invalid をすべて拒むことを確かめる。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleeunit/should
import rondo_server/games/veryare/missed_events
import rondo_server/protocol/message
import rondo_server/room/room_actor.{PlayerId}

const fixture_path = "../packages/contracts/src/fixtures/veryare-missed.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(section: String, kind: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(text, decode.at([section, kind], decode.list(decode.dynamic)))
  list
}

fn rejects_all(section: String, decoder: decode.Decoder(a)) -> Nil {
  let invalid = samples(section, "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    decode.run(sample, decoder) |> should.be_error
  })
}

pub fn sight_samples_test() {
  samples("sight", "valid")
  |> list.map(fn(sample) {
    let assert Ok(ids) = decode.run(sample, missed_events.sight_decoder())
    ids
  })
  |> should.equal([[], ["p-2", "p-3"]])
  rejects_all("sight", missed_events.sight_decoder())
}

pub fn like_samples_test() {
  samples("like", "valid")
  |> list.map(fn(sample) {
    let assert Ok(target) = decode.run(sample, missed_events.like_decoder())
    target
  })
  |> should.equal(["p-2"])
  rejects_all("like", missed_events.like_decoder())
}

pub fn likes_notice_samples_test() {
  samples("likesNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(likes) = missed_events.decode_likes(sample)
    likes
  })
  |> should.equal([[], [#("p-2", 2), #("p-3", 0)]])
  list.each(samples("likesNotice", "invalid"), fn(sample) {
    missed_events.decode_likes(sample) |> should.be_error
  })
}

/// サーバーが送るいいねの数の通知は、そのまま読み戻せる。
pub fn server_likes_notice_round_trips_test() {
  let text =
    missed_events.likes_payload([#(PlayerId("p-2"), 2), #(PlayerId("p-3"), 0)])
    |> message.json_of_dynamic
    |> json.to_string
  let assert Ok(value) = json.parse(text, decode.dynamic)
  missed_events.decode_likes(value)
  |> should.equal(Ok([#("p-2", 2), #("p-3", 0)]))
}
