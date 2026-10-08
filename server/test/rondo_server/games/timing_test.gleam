//// テスト用のフェーズ時間の短縮（issue-49）。環境変数でだけ有効にし、既定では本番の
//// 時間のまま。縮めても、フェーズの順序と勝敗は変わらない。

import gleam/dynamic
import gleam/erlang/process
import gleam/list
import gleam/option.{None}
import gleeunit/should
import rondo_server/games/catalog
import rondo_server/games/timing.{Faster, Normal}
import rondo_server/games/veryare/game.{Durations}
import rondo_server/games/veryare/stage
import rondo_server/room/room_actor

/// 環境変数が無ければ、短縮しない（本番の既定）。
pub fn missing_env_means_normal_test() {
  timing.from_env(Error(Nil)) |> should.equal(Normal)
}

/// 2 以上の整数なら、その数でフェーズ時間を割る。
pub fn integer_divisor_enables_faster_phases_test() {
  timing.from_env(Ok("20")) |> should.equal(Faster(divisor: 20))
  timing.from_env(Ok(" 5 ")) |> should.equal(Faster(divisor: 5))
}

/// 1 以下・数でない・空・大きすぎる値は、短縮しない（取り違えて本番を速めない）。
pub fn invalid_values_mean_normal_test() {
  list.each(["", "1", "0", "-3", "fast", "2.5", "1001"], fn(raw) {
    timing.from_env(Ok(raw)) |> should.equal(Normal)
  })
}

/// 短縮しなければ、時間はそのまま。
pub fn normal_keeps_durations_test() {
  let durations = game.durations(exploration_ms: 40_000)
  timing.apply(durations, Normal) |> should.equal(durations)
}

/// 短縮すると、全フェーズを同じ数で割る（比は変わらない）。0 にはしない。
pub fn faster_divides_every_phase_test() {
  timing.apply(game.durations(exploration_ms: 40_000), Faster(divisor: 20))
  |> should.equal(Durations(
    oni_selection_ms: 500,
    preparation_ms: 1000,
    painting_ms: 1000,
    exploration_ms: 2000,
    reveal_ms: 1000,
    reload_ms: 150,
  ))
  timing.apply(
    Durations(
      oni_selection_ms: 3,
      preparation_ms: 3,
      painting_ms: 3,
      exploration_ms: 3,
      reveal_ms: 3,
      reload_ms: 3,
    ),
    Faster(divisor: 1000),
  )
  |> should.equal(Durations(
    oni_selection_ms: 1,
    preparation_ms: 1,
    painting_ms: 1,
    exploration_ms: 1,
    reveal_ms: 1,
    reload_ms: 1,
  ))
}

/// 縮めても、状態機械の進み方（フェーズの順序と勝敗）は同じ。時間は状態機械の外の
/// タイマーにだけ効くことを、同じ操作の列で確かめる。
pub fn faster_phases_keep_order_and_outcome_test() {
  let run = fn(timing_value) {
    let durations =
      timing.apply(game.durations(exploration_ms: 40_000), timing_value)
    let pick = fn(_size) { 0 }
    let expire = fn(g: game.Game(String)) { game.advance(g, g.step, pick) }
    let start =
      game.new(["a", "b", "c"], durations, stage.generate(0))
      |> game.move("a", 0.0, 0.0)
    let steps = [
      start,
      expire(start),
      expire(expire(start)),
      expire(expire(expire(start))),
      expire(expire(expire(expire(start)))),
      expire(expire(expire(expire(expire(start))))),
    ]
    list.map(steps, fn(g) { g.phase })
  }
  run(Faster(divisor: 20)) |> should.equal(run(Normal))
}

/// 実接続の入口（catalog）から作った veryare のルームも、短縮した時間で進む。
pub fn catalog_rooms_use_the_timing_test() {
  let assert Ok(#(spec, _policy)) =
    catalog.spec_for(
      "veryare",
      room_actor.RoomId("t"),
      None,
      Faster(divisor: 1000),
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data
  list.each(["a", "b"], fn(id) {
    let assert Ok(Nil) =
      room_actor.join(room, room_actor.Player(room_actor.PlayerId(id), id))
  })
  let outbox = process.new_subject()
  room_actor.subscribe(room, room_actor.PlayerId("a"), outbox)
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(
    room,
    room_actor.PlayerId("a"),
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ]),
  )
  // 本番なら 10 + 20 + 20 + 40 + 20 秒かかるところが、1 秒もかからずに終わる。
  wait_until_finished(room, 50)
}

fn wait_until_finished(room, tries: Int) -> Nil {
  case room_actor.snapshot(room).status, tries {
    room_actor.Finished, _ -> Nil
    _, 0 -> panic as "短縮した時間で終わらない"
    _, _ -> {
      process.sleep(20)
      wait_until_finished(room, tries - 1)
    }
  }
}

/// 撃つ間隔も同じ数で割る。本番の既定（短縮しない）は 3 秒のまま。どれだけ縮めても 0 には
/// ならない（0 だと間隔の判定が効かなくなる）。
pub fn reload_is_scaled_but_never_zero_test() {
  let durations = game.durations(exploration_ms: 40_000)
  timing.apply(durations, Normal).reload_ms |> should.equal(3000)
  timing.apply(durations, Faster(divisor: 20)).reload_ms |> should.equal(150)
  timing.apply(durations, Faster(divisor: 1000)).reload_ms |> should.equal(3)
  list.each([2, 7, 20, 999, 1000], fn(divisor) {
    let reload = timing.apply(durations, Faster(divisor:)).reload_ms
    { reload >= 1 } |> should.be_true
  })
}
