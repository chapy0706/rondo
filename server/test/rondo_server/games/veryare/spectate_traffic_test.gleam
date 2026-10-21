//// 観戦用の通知の通信量（issue-67 段階 ③）。観戦者 20 人（上限）が、隠れ CPU 4 体（上限）の歩く準備移動を
//// 見ている 1 秒間に、受け取る観戦用の通知の数と、1 通の大きさ（接続へ送る JSON の文字列）を測る。
////
//// 目安: 観戦ルーム 1 つで、毎秒 200 通以下（観戦者 1 人あたり、100 ms ごとに 1 通まで = 毎秒 10 通）。
//// 入った直後の 1 通（入室の状態）は、別に数える。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/room.{RandomLayout, SpectateSettings} as veryare
import rondo_server/games/veryare/spectate_notice.{Actor, Look}
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/room_actor.{
  type Message, Player, PlayerId, RoomId, Spectate, SpectateConfig,
}

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int

const spectators = 20

/// 観戦者 1 人が 1 秒に受け取る、観戦用の通知の上限（100 ms ごとに 1 通）。
const per_second = 10

/// 1 通の大きさの上限（バイト。隠れ CPU 4 体と鬼 CPU の 5 人ぶん）。
const max_bytes = 600

fn open() -> Subject(Message) {
  let spec =
    veryare.spectate_spec_with(
      RoomId("t"),
      SpectateSettings(4, 40, RandomLayout),
      game.Durations(
        oni_selection_ms: 10_000,
        preparation_ms: 20_000,
        painting_ms: 20_000,
        exploration_ms: 40_000,
        reveal_ms: 20_000,
        reload_ms: 3000,
      ),
      fn(size) { 5 % size },
      monotonic_ms,
    )
  let assert Ok(started) =
    room_actor.start_with(
      spec,
      Spectate(SpectateConfig(
        max_spectators: spectators,
        next_game_ms: 10_000,
        idle_close_ms: 60_000,
      )),
    )
  let assert Ok(Nil) = room_actor.start_game(started.data)
  started.data
}

fn type_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["type"], decode.string))
  |> result.unwrap("?")
}

fn is_notice(message: ServerMessage) -> Bool {
  case message {
    GameState(payload:, ..) | GameStateTo(payload:, ..) ->
      type_of(payload) == "spectate"
    _ -> False
  }
}

fn do_drain(outbox, acc) {
  case process.receive(outbox, 0) {
    Ok(m) -> do_drain(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn bytes(message: ServerMessage) -> Int {
  string.byte_size(message.encode_server(message))
}

/// 観戦者 20 人が 1 秒間に受け取る観戦用の通知は、毎秒 200 通以下。1 通は 600 バイト以下。
pub fn twenty_spectators_stay_within_the_budget_test() {
  let room = open()
  let outboxes =
    list.map(int.range(1, spectators + 1, [], list.prepend), fn(n) {
      let outbox = process.new_subject()
      let id = "s" <> int.to_string(n)
      let assert Ok(Nil) =
        room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
      outbox
    })
  // 入った直後の 1 通（入室の状態）を読み捨ててから、1 秒間に届いた分を数える。
  list.each(outboxes, fn(outbox) { do_drain(outbox, []) })
  process.sleep(1000)
  let received =
    list.map(outboxes, fn(outbox) {
      do_drain(outbox, []) |> list.filter(is_notice)
    })
  room_actor.dissolve(room)

  let counts = list.map(received, list.length)
  // 隠れ CPU は歩き続けているので、毎回変わり、ほぼ 10 通ずつ届く。
  list.each(counts, fn(count) {
    { count >= per_second - 2 && count <= per_second + 1 } |> should.be_true
  })
  { int.sum(counts) <= spectators * { per_second + 1 } } |> should.be_true
  list.flatten(received)
  |> list.each(fn(m) { { bytes(m) <= max_bytes } |> should.be_true })
}

/// 5 人ぶん（隠れ CPU 4 体と鬼 CPU）の通知の大きさ。座標と向きは、小数第 2 位までに丸めて送る。色と
/// ポーズ（looks）つきの 1 通（試合の最初と、入室・復帰のとき）も、1 KB 以下。
pub fn notice_size_for_five_actors_test() {
  let actors =
    list.map(["cpu-2", "cpu-3", "cpu-4", "cpu-5", "cpu-1"], fn(id) {
      Actor(id, -12.34, 18.75, -3.14, "crouching")
    })
  let looks =
    list.map(["cpu-2", "cpu-3", "cpu-4", "cpu-5"], fn(id) {
      Look(id, "crouching", "#a8956a")
    })
  let wrap = fn(payload) { GameState("veryare", "room-1", payload) }
  { bytes(wrap(spectate_notice.payload(actors, None))) <= max_bytes }
  |> should.be_true
  { bytes(wrap(spectate_notice.payload(actors, Some(looks)))) <= 1024 }
  |> should.be_true
}
