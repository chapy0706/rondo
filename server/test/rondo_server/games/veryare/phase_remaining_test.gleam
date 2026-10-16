//// フェーズの通知の長さは、通知を作った時点からの残り（ADR 0046）。フェーズの開始のときの通知は、
//// フェーズの長さ（これまでと同じ）。送り直し（途中参加・復帰）のときだけ、残り（長さ − 経過。0 未満に
//// しない）になる。時計は、テストで差し替える（手で進める時計）。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/otp/actor
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, RandomLayout, Settings} as veryare
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/room_actor.{type Message, Player, PlayerId, RoomId}

// --- 手で進める時計 ---------------------------------------------------------------

type ClockMessage {
  Now(reply: Subject(Int))
  Advance(by: Int)
}

fn start_clock(at: Int) -> Subject(ClockMessage) {
  let assert Ok(started) =
    actor.new(at)
    |> actor.on_message(fn(now, message) {
      case message {
        Now(reply) -> {
          process.send(reply, now)
          actor.continue(now)
        }
        Advance(by) -> actor.continue(now + by)
      }
    })
    |> actor.start
  started.data
}

fn advance(clock: Subject(ClockMessage), by: Int) -> Nil {
  process.send(clock, Advance(by))
}

// --- ルーム ---------------------------------------------------------------------

const preparation_ms = 20_000

fn durations() -> game.Durations {
  game.Durations(
    // 鬼選出のカウントは本物のタイマーで進むので、短くする。
    oni_selection_ms: 30,
    preparation_ms: preparation_ms,
    painting_ms: 20_000,
    exploration_ms: 40_000,
    reveal_ms: 20_000,
    reload_ms: 3000,
  )
}

/// a と b がいて、a が鬼希望エリアに触れ、準備移動に入ったルーム。
/// 4 つ目は、準備移動に入ったときに b に全員宛てで届いた通知の長さ。
fn in_preparation(
  clock: Subject(ClockMessage),
) -> #(
  Subject(Message),
  Subject(ServerMessage),
  Subject(ServerMessage),
  Option(Int),
) {
  let assert Ok(started) =
    room_actor.start(
      veryare.spec_with_clock(
        RoomId("r"),
        Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
        RandomLayout,
        durations(),
        fn(_size) { 0 },
        fn() { process.call(clock, 1000, Now) },
      ),
    )
  let room = started.data
  let a = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("a"), "a"), a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let b = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("b"), "b"), b)
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ]),
  )
  // カウント（30 ms）が終わり、準備移動の通知が届くまで待つ。
  let assert Some(start) = wait_phase(b, "preparation", 40)
  #(room, a, b, start)
}

fn drain(outbox: Subject(ServerMessage)) -> List(Dynamic) {
  case process.receive(outbox, 200) {
    Ok(GameState(payload:, ..)) | Ok(GameStateTo(payload:, ..)) -> [
      payload,
      ..drain(outbox)
    ]
    Ok(_) -> drain(outbox)
    Error(Nil) -> []
  }
}

/// フェーズの通知の、フェーズと長さ。
fn phase_of(payload: Dynamic) -> Option(#(String, Option(Int))) {
  let decoder = {
    use kind <- decode.field("type", decode.string)
    use phase <- decode.field("phase", decode.string)
    use duration <- decode.field("durationMs", decode.optional(decode.int))
    case kind {
      "phase" -> decode.success(#(phase, duration))
      _ -> decode.failure(#("", None), "phase")
    }
  }
  decode.run(payload, decoder) |> option.from_result
}

/// phase のフェーズの通知が届くまで読む（tries 回まで）。届いた通知の長さ。
fn wait_phase(
  outbox: Subject(ServerMessage),
  phase: String,
  tries: Int,
) -> Option(Option(Int)) {
  case tries <= 0 {
    True -> None
    False -> {
      let found =
        drain(outbox)
        |> list.filter_map(fn(p) {
          case phase_of(p) {
            Some(#(name, duration)) if name == phase -> Ok(duration)
            _ -> Error(Nil)
          }
        })
        |> list.last
      case found {
        Ok(duration) -> Some(duration)
        Error(Nil) -> wait_phase(outbox, phase, tries - 1)
      }
    }
  }
}

/// 復帰したときに届く、準備移動の通知の長さ。
fn resynced_duration(
  room: Subject(Message),
  id: String,
  outbox: Subject(ServerMessage),
) -> Option(Int) {
  let _ = drain(outbox)
  room_actor.resync(room, PlayerId(id))
  let assert Some(duration) = wait_phase(outbox, "preparation", 5)
  duration
}

// --- テスト -------------------------------------------------------------------

/// フェーズの開始のときの通知は、フェーズの長さのまま（開始の前に時計が進んでいても）。
pub fn start_notice_keeps_full_length_test() {
  let clock = start_clock(1000)
  advance(clock, 7000)
  let #(_, _, _, start) = in_preparation(clock)
  start |> should.equal(Some(preparation_ms))
}

/// 準備移動に入ってから 5 秒たって復帰すると、長さは残りの 15 秒。開始の通知は 20 秒だった。
pub fn resync_after_five_seconds_gets_remaining_test() {
  let clock = start_clock(1000)
  let #(room, _, b, _) = in_preparation(clock)
  advance(clock, 5000)
  resynced_duration(room, "b", b) |> should.equal(Some(preparation_ms - 5000))
}

/// 作った人の復帰でも、同じ残り。
pub fn creator_resync_gets_remaining_test() {
  let clock = start_clock(1000)
  let #(room, a, _, _) = in_preparation(clock)
  advance(clock, 12_000)
  resynced_duration(room, "a", a) |> should.equal(Some(preparation_ms - 12_000))
}

/// 長さより長くたっても（タイマーが遅れて、まだ次のフェーズに移っていなくても）、0 未満にならない。
pub fn remaining_never_goes_below_zero_test() {
  let clock = start_clock(1000)
  let #(room, _, b, _) = in_preparation(clock)
  advance(clock, preparation_ms + 9000)
  resynced_duration(room, "b", b) |> should.equal(Some(0))
}

/// 時計が進んでいなければ、送り直しでも、フェーズの長さ（開始の通知と同じ）。
pub fn resync_right_after_start_gets_full_length_test() {
  let clock = start_clock(1000)
  let #(room, _, b, _) = in_preparation(clock)
  resynced_duration(room, "b", b) |> should.equal(Some(preparation_ms))
}

/// 鬼選出の間の通知は、長さを持たない（途中参加・復帰でも null のまま）。
pub fn oni_selection_has_no_length_test() {
  let clock = start_clock(1000)
  let assert Ok(started) =
    room_actor.start(
      veryare.spec_with_clock(
        RoomId("o"),
        Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
        RandomLayout,
        durations(),
        fn(_size) { 0 },
        fn() { process.call(clock, 1000, Now) },
      ),
    )
  let room = started.data
  let a = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("a"), "a"), a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let b = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("b"), "b"), b)
  advance(clock, 3000)
  wait_phase(b, "oni-selection", 3) |> should.equal(Some(None))
}

/// 残りの求め方（純粋な関数）: 長さ − 経過。0 から長さの間に収める。
pub fn remaining_ms_test() {
  veryare.remaining_ms(20_000, 0) |> should.equal(20_000)
  veryare.remaining_ms(20_000, 5000) |> should.equal(15_000)
  veryare.remaining_ms(20_000, 25_000) |> should.equal(0)
  // 時計が戻っても（経過が負でも）、長さを超えない。
  veryare.remaining_ms(20_000, -100) |> should.equal(20_000)
}
