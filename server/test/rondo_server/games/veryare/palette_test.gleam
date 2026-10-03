import gleam/list
import gleeunit/should
import rondo_server/games/veryare/palette.{Rgb}
import rondo_server/games/veryare/stage

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
