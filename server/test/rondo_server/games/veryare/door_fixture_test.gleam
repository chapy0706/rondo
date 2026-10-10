//// 襖の報告と通知の形（issue-29b / ADR 0009）。TS の契約の見本
//// （packages/contracts/src/fixtures/veryare-events.json の openDoor・doorsNotice）を読み、
//// サーバーが valid をすべて受け付け、invalid をすべて拒むことを確かめる。TS 側は、同じ JSON の
//// valid が TS の型で書いた見本と一致することを確かめている。

import gleam/bit_array
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/stage.{Cell}
import rondo_server/games/veryare/stage_notice
import rondo_server/protocol/message

const fixture_path = "../packages/contracts/src/fixtures/veryare-events.json"

@external(erlang, "file", "read_file")
fn read_file(path: String) -> Result(BitArray, Dynamic)

fn samples(section: String, kind: String) -> List(Dynamic) {
  let assert Ok(bytes) = read_file(fixture_path)
  let assert Ok(text) = bit_array.to_string(bytes)
  let assert Ok(list) =
    json.parse(text, decode.at([section, kind], decode.list(decode.dynamic)))
  list
}

/// 開ける報告: valid はすべて境として読め、invalid（境が無い・隣り合わない・形が違う・別の
/// 種類）はすべて拒む。
pub fn open_door_samples_test() {
  samples("openDoor", "valid")
  |> list.map(fn(sample) {
    let assert Ok(edge) = decode.run(sample, stage_notice.open_door_decoder())
    edge
  })
  |> should.equal([
    grid.edge(Cell(1, 1), Cell(2, 1)),
    grid.edge(Cell(2, 2), Cell(2, 3)),
  ])
  let invalid = samples("openDoor", "invalid")
  { invalid != [] } |> should.be_true
  list.each(invalid, fn(sample) {
    decode.run(sample, stage_notice.open_door_decoder()) |> should.be_error
  })
}

/// 襖の通知: valid はすべて読め、invalid はすべて拒む。
pub fn doors_notice_samples_test() {
  samples("doorsNotice", "valid")
  |> list.map(fn(sample) {
    let assert Ok(open) = stage_notice.decode_doors(sample)
    set.size(open)
  })
  |> should.equal([0, 2])
  list.each(samples("doorsNotice", "invalid"), fn(sample) {
    stage_notice.decode_doors(sample) |> should.be_error
  })
}

/// サーバーが送る襖の通知は、そのまま読み戻せる（JSON を経ても同じ）。
pub fn server_doors_notice_round_trips_test() {
  let open =
    set.from_list([
      grid.edge(Cell(1, 1), Cell(2, 1)),
      grid.edge(Cell(5, 4), Cell(5, 3)),
    ])
  let text =
    stage_notice.doors_payload(open)
    |> message.json_of_dynamic
    |> json.to_string
  let assert Ok(value) = json.parse(text, decode.dynamic)
  stage_notice.decode_doors(value) |> should.equal(Ok(open))
}
