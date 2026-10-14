//// 極端な座標の移動の報告（issue-51 の不正な入力の試験で見つかった問題）。
////
//// x に 1e308 を送ると、待機ルームの円に丸める計算（x × x）が桁あふれして、ルームのプロセスが落ちた
//// （その部屋の全員が遊べなくなる）。座標の上限（max_coordinate）を超える報告は、無視する。

import gleam/dynamic
import gleam/list
import gleam/option.{Some}
import gleeunit/should
import rondo_server/games/veryare/game.{Position, WaitingRoom}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, Settings} as veryare
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage
import rondo_server/room/driver
import rondo_server/room/room_actor.{PlayerId, RoomId}

fn start() {
  game.new(
    ["a", "b"],
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
  )
}

/// 座標の上限は、どのステージよりも十分に大きい（平屋・骨格は 100 m に届かない）。
pub fn max_coordinate_is_generous_test() {
  { game.max_coordinate >=. 1000.0 } |> should.be_true
}

/// 待機ルームで、極端な座標の報告は落ちずに無視する（位置は変わらない）。
pub fn extreme_waiting_room_move_is_ignored_test() {
  let g = start()
  list.each(
    [
      #(1.0e308, 0.0),
      #(0.0, -1.0e308),
      #(1.7976931348623157e308, 1.7976931348623157e308),
      #(1.0e154, 1.0e154),
      #(game.max_coordinate +. 1.0, 0.0),
    ],
    fn(target) {
      let moved = game.move(g, "a", target.0, target.1)
      moved.positions |> should.equal(g.positions)
    },
  )
}

/// 上限ちょうどまでは、ふつうの報告として受け付ける（円に丸める）。
pub fn move_at_max_coordinate_is_clamped_test() {
  let moved = start() |> game.move("a", game.max_coordinate, 0.0)
  let assert Ok(Position(WaitingRoom, x, z)) = dict_get(moved, "a")
  #(x, z) |> should.equal(#(game.waiting_room_radius, 0.0))
}

/// ステージでも、極端な座標の報告は落ちずに無視する。
pub fn extreme_stage_move_is_ignored_test() {
  let g =
    start()
    |> game.move("a", 0.0, 0.0)
    |> game.advance(1, fn(_) { 0 })
    |> spread.hiders(["b"])
  let moved = game.move(g, "b", 1.0e308, -1.0e308)
  moved.positions |> should.equal(g.positions)
}

/// ルームを通しても、極端な座標の報告でルームが止まらず、そのあとも進む（立候補でカウントが始まる）。
pub fn extreme_move_does_not_stop_the_room_test() {
  let spec =
    veryare.spec_with(
      RoomId("v"),
      Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
      game.durations(exploration_ms: 40_000),
      fn(_) { 0 },
    )
  let assert Some(factory) = spec.driver
  let #(d, _) = factory([PlayerId("a"), PlayerId("b")])
  let huge =
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(1.0e308)),
      #(dynamic.string("z"), dynamic.float(-1.0e308)),
      #(dynamic.string("facing"), dynamic.float(1.0e308)),
    ])
  let #(d, _) = driver.event(d, PlayerId("a"), huge)
  let touch =
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ])
  let #(_, effects) = driver.event(d, PlayerId("a"), touch)
  // カウントの開始で、鬼選出のタイマーが張られる。
  list.any(effects, fn(effect) {
    case effect {
      driver.WakeAfter(ms, _) -> ms == 10_000
      _ -> False
    }
  })
  |> should.be_true
}

fn dict_get(g: game.Game(String), id: String) {
  game.position_of_player(g, id)
}
