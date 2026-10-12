//// 隠れ側のポーズ（issue-56）。素材のポーズの識別子の一覧と、CPU・鬼のポーズの値が、共有の見本
//// （packages/contracts/src/fixtures/veryare-poses.json）と一致すること（ADR 0009）。

import gleam/bit_array
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/pose

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn fixture() -> Dynamic {
  let assert Ok(bytes) =
    read_file("../packages/contracts/src/fixtures/veryare-poses.json")
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(value) = json.parse(text, decode.dynamic)
  value
}

/// 素材のポーズの識別子は、見本の poses の id と同じ順・同じもの（23 個）。
pub fn model_poses_match_the_fixture_test() {
  let assert Ok(ids) =
    decode.run(
      fixture(),
      decode.at(["poses"], decode.list(decode.at(["id"], decode.string))),
    )
  pose.model_poses |> should.equal(ids)
  list.length(pose.model_poses) |> should.equal(23)
}

/// CPU・鬼のポーズの値（standing・crouching・lying）は、見本の cpu の鍵と同じ。
pub fn cpu_poses_match_the_fixture_test() {
  let assert Ok(cpu) =
    decode.run(
      fixture(),
      decode.at(["cpu"], decode.dict(decode.string, decode.string)),
    )
  dict.keys(cpu)
  |> list.sort(string.compare)
  |> should.equal(pose.cpu_poses |> list.sort(string.compare))
}

/// 一覧の識別子だけを受け付ける。CPU の値・未知の値は None。
pub fn parse_accepts_only_model_poses_test() {
  pose.parse("maleCrouch") |> should.equal(Some("maleCrouch"))
  pose.parse("idle") |> should.equal(Some("idle"))
  pose.parse("standing") |> should.equal(None)
  pose.parse("moonwalk") |> should.equal(None)
}
