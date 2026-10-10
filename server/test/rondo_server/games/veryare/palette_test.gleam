import gleam/bit_array
import gleam/dynamic
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleeunit/should
import rondo_server/games/veryare/palette.{Rgb}
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/stage_notice

/// 同じ色の差は 0。
pub fn same_color_is_zero_test() {
  palette.difference(Rgb(120, 80, 40), Rgb(120, 80, 40))
  |> should.equal(0.0)
}

/// 最も離れた色（黒と白）の差は 1。
pub fn black_and_white_are_one_test() {
  palette.difference(Rgb(0, 0, 0), Rgb(255, 255, 255))
  |> should.equal(1.0)
  palette.difference(Rgb(255, 255, 255), Rgb(0, 0, 0))
  |> should.equal(1.0)
}

/// 差は 0〜1 に収まり、近い色ほど小さい。
pub fn difference_is_between_zero_and_one_and_grows_with_distance_test() {
  let base = Rgb(100, 100, 100)
  let near = palette.difference(base, Rgb(110, 100, 100))
  let far = palette.difference(base, Rgb(200, 100, 100))
  { near >. 0.0 } |> should.be_true
  { near <. far } |> should.be_true
  { far <. 1.0 } |> should.be_true
}

/// 部屋タイプごとに代表色を持ち、値は 0〜255 に収まる。
pub fn every_room_type_has_a_representative_color_test() {
  [
    stage.Washitsu,
    stage.WashitsuWithOshiire,
    stage.WashitsuWithKakejiku,
    stage.Oshiire,
  ]
  |> list.each(fn(room) {
    let Rgb(r, g, b) = palette.room_color(room)
    list.each([r, g, b], fn(channel) {
      { channel >= 0 && channel <= 255 } |> should.be_true
    })
  })
}

/// 色を "#rrggbb" の形で書き出す（配信用）。
pub fn color_is_written_as_hex_test() {
  palette.to_hex(Rgb(0, 128, 255)) |> should.equal("#0080ff")
  palette.to_hex(Rgb(255, 255, 255)) |> should.equal("#ffffff")
}

// --- クライアントとの共有の見本（issue-29c） --------------------------------------------

@external(erlang, "file", "read_file")
fn read_palette_file(path: String) -> Result(BitArray, dynamic.Dynamic)

/// 代表色の見本（packages/contracts/src/fixtures/veryare-palette.json）が、サーバーの値と一致する。
/// クライアントの床の色と、ペイントの代表色は、この見本と同じ表を使う。
pub fn palette_fixture_matches_the_server_test() {
  let assert Ok(bytes) =
    read_palette_file("../packages/contracts/src/fixtures/veryare-palette.json")
  let assert Ok(text) = bit_array.to_string(bytes)
  let field = fn(path: List(String)) {
    let assert Ok(value) = json.parse(text, decode.at(path, decode.string))
    value
  }
  field(["floor"]) |> should.equal(palette.to_hex(palette.floor_color))
  field(["unpainted"]) |> should.equal(palette.to_hex(palette.unpainted))
  list.each(
    [
      stage.Washitsu,
      stage.WashitsuWithOshiire,
      stage.WashitsuWithKakejiku,
      stage.Oshiire,
    ],
    fn(room) {
      field(["rooms", stage_notice.room_name(room)])
      |> should.equal(palette.to_hex(palette.room_color(room)))
    },
  )
}
