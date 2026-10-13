//// 待機ルームのメンバーの通知と、待機ポーズの変更の形（issue-59 / ADR 0009）。TS の契約の見本
//// （packages/contracts/src/fixtures/veryare-members.json）を読み、サーバーが valid をすべて受け付け、
//// invalid をすべて拒むことを確かめる。TS 側は、同じ JSON の valid が TS の型で書いた見本と一致する
//// ことを確かめている。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/game.{WaitingMember}
import rondo_server/games/veryare/members.{Member}
import rondo_server/protocol/message
import rondo_server/room/room_actor.{PlayerId}

const fixture_path = "../packages/contracts/src/fixtures/veryare-members.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(section: String, kind: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(text, decode.at([section, kind], decode.list(decode.dynamic)))
  list
}

/// メンバーの通知: valid はすべて読め、invalid はすべて拒む。
pub fn members_notice_samples_test() {
  samples("membersNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(list) = members.decode_notice(sample)
    list
  })
  |> should.equal([
    [],
    [
      Member("p-1", 2.0, 0.0, Some(1.55), Some("femaleDance")),
      Member("p-2", -1.25, 0.5, None, None),
    ],
  ])
  let invalid = samples("membersNotice", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    members.decode_notice(sample) |> should.be_error
  })
}

/// 待機ポーズの変更: valid はすべて受け付け、invalid（一覧に無い・形が違う・別の種類）はすべて拒む。
pub fn waiting_pose_samples_test() {
  samples("waitingPose", "valid")
  |> list.map(fn(sample) {
    let assert Ok(pose) = decode.run(sample, members.waiting_pose_decoder())
    pose
  })
  |> should.equal(["femaleDance", "idle"])
  let invalid = samples("waitingPose", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    decode.run(sample, members.waiting_pose_decoder()) |> should.be_error
  })
}

/// サーバーが送るメンバーの通知は、そのまま読み戻せる（JSON を経ても同じ）。
pub fn server_members_notice_round_trips_test() {
  let text =
    members.payload([
      WaitingMember(PlayerId("p-1"), 2.0, 0.0, Some(1.55), Some("femaleDance")),
      WaitingMember(PlayerId("p-2"), -1.25, 0.5, None, None),
    ])
    |> message.json_of_dynamic
    |> json.to_string
  let assert Ok(value) = json.parse(text, decode.dynamic)
  members.decode_notice(value)
  |> should.equal(
    Ok([
      Member("p-1", 2.0, 0.0, Some(1.55), Some("femaleDance")),
      Member("p-2", -1.25, 0.5, None, None),
    ]),
  )
}
