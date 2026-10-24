//// 動ける隠れ側の規則の通知の形と、取り決めた値（ADR 0053 / ADR 0009）。TS の契約の見本
//// （packages/contracts/src/fixtures/veryare-roaming.json）を読み、サーバーが valid をすべて読め、invalid を
//// すべて拒むこと、既定の規則・見た目の更新の間・襖が開く距離がサーバーの値と同じことを確かめる。TS 側は、
//// 同じ JSON が TS の型で書いた見本と、契約の値（VERYARE_ROAMING）と一致することを確かめている。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/game.{RoamingHider}
import rondo_server/games/veryare/paint
import rondo_server/games/veryare/roaming.{Hider, Look}
import rondo_server/games/veryare/room as veryare
import rondo_server/protocol/message
import rondo_server/room/room_actor.{PlayerId}

const fixture_path = "../packages/contracts/src/fixtures/veryare-roaming.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn read(path: List(String), decoder: decode.Decoder(a)) -> a {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(value) = json.parse(text, decode.at(path, decoder))
  value
}

fn samples(section: String, kind: String) -> List(Dynamic) {
  read([section, kind], decode.list(decode.dynamic))
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.int |> decode.map(int.to_float)])
}

/// 既定の規則・見た目の更新の間・襖が開く距離は、サーバーの値と同じ。
pub fn agreed_values_test() {
  read(["defaultRoaming"], decode.int) |> should.equal(veryare.default_roaming)
  read(["lookIntervalMs"], decode.int) |> should.equal(game.look_interval_ms)
  read(["autoDoorReach"], number()) |> should.equal(game.auto_door_reach)
  read(["defaultSpreading"], decode.int)
  |> should.equal(veryare.default_spreading)
}

/// 鬼の通知の others（増え鬼）: 従来の形は None、増え鬼の形は読め、形の違う others は拒む。
pub fn oni_notice_others_samples_test() {
  samples("oniNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(others) = roaming.decode_others(sample)
    others
  })
  |> should.equal([
    None,
    Some([Hider("p-2", 2.25, 3.5, Some(-0.5)), Hider("p-3", 6.0, 1.5, None)]),
  ])
  let invalid = samples("oniNotice", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    roaming.decode_others(sample) |> should.be_error
  })
}

/// 動く隠れ側の通知: valid はすべて読め、invalid はすべて拒む。
pub fn roaming_notice_samples_test() {
  samples("roamingNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(hiders) = roaming.decode_notice(sample)
    hiders
  })
  |> should.equal([
    [],
    [Hider("p-2", 4.25, 10.5, Some(1.55)), Hider("p-3", -1.0, 0.5, None)],
  ])
  let invalid = samples("roamingNotice", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    roaming.decode_notice(sample) |> should.be_error
  })
}

/// 見た目の通知: valid はすべて読め、invalid（ポーズが一覧に無い・全面 1 色・別の種類）はすべて拒む。
pub fn look_notice_samples_test() {
  samples("lookNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(look) = roaming.decode_look(sample)
    look
  })
  |> should.equal([
    Look("p-2", None, None),
    Look(
      "p-3",
      Some("maleCrouch"),
      Some([paint.Stroke(paint.Torso, "#a07850", 0.04, [#(0.25, 0.5)])]),
    ),
  ])
  let invalid = samples("lookNotice", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    roaming.decode_look(sample) |> should.be_error
  })
}

/// サーバーが送る 2 つの通知は、そのまま読み戻せる（JSON を経ても同じ）。
pub fn server_notices_round_trip_test() {
  let parse = fn(payload: Dynamic) {
    let text = payload |> message.json_of_dynamic |> json.to_string
    let assert Ok(value) = json.parse(text, decode.dynamic)
    value
  }
  roaming.payload([
    RoamingHider(PlayerId("p-2"), 4.25, 10.5, Some(1.55)),
    RoamingHider(PlayerId("p-3"), -1.0, 0.5, None),
  ])
  |> parse
  |> roaming.decode_notice
  |> should.equal(
    Ok([Hider("p-2", 4.25, 10.5, Some(1.55)), Hider("p-3", -1.0, 0.5, None)]),
  )
  let strokes = [paint.Stroke(paint.LeftArm, "#112233", 0.05, [#(0.5, 0.5)])]
  roaming.look_payload(PlayerId("p-2"), Some("idle"), Some(strokes))
  |> parse
  |> roaming.decode_look
  |> should.equal(Ok(Look("p-2", Some("idle"), Some(strokes))))
}
