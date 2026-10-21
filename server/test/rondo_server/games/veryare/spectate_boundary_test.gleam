//// 観戦用の通知の境目（issue-67 段階 ③ / ADR 0021・0035）。ルーム（room_actor）を通して確かめる。
////
//// - 人間の対戦ルームでは、観戦用の通知が出ない（試合を結果まで回しても、一度も届かない）
//// - 参加者でない接続（観戦者でもない）には、観戦ルームでも届かない
//// - 観戦者の操作（移動・射撃・襖）は捨てられ、ゲームに届かない
//// - 観戦者は、人間の対戦ルームには入れない。対戦のルームに入る人は参加者で、観戦者にはならない
////   （観戦者になるのは、観戦ルームの種類の接続だけ）。試合が始まった対戦のルームには、途中から入れない

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/result
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{
  OniCpu, RandomLayout, Settings, SpectateSettings,
} as veryare
import rondo_server/protocol/message.{
  type ServerMessage, GameEnded, GameState, GameStateTo,
}
import rondo_server/room/room_actor.{
  type Message, GameAlreadyStarted, Player, PlayerId, RoomId, Spectate,
  SpectateConfig,
}

fn type_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["type"], decode.string))
  |> result.unwrap("?")
}

/// 少し待ってから、いま届いている分だけを読む（観戦ルームは通知を送り続けるので、届かなくなるまで
/// 待つ形では、読み終わらない）。
fn drain(outbox: Subject(ServerMessage), wait_ms: Int) -> List(ServerMessage) {
  process.sleep(wait_ms)
  do_drain(outbox, [])
}

fn do_drain(outbox, acc) {
  case process.receive(outbox, 0) {
    Ok(m) -> do_drain(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn payloads(messages: List(ServerMessage)) -> List(Dynamic) {
  list.filter_map(messages, fn(m) {
    case m {
      GameState(payload:, ..) | GameStateTo(payload:, ..) -> Ok(payload)
      _ -> Error(Nil)
    }
  })
}

fn spectate_notices(messages: List(ServerMessage)) -> List(Dynamic) {
  messages |> payloads |> list.filter(fn(p) { type_of(p) == "spectate" })
}

fn actor_ids(notice: Dynamic) -> List(String) {
  decode.run(
    notice,
    decode.at(["actors"], decode.list(decode.at(["playerId"], decode.string))),
  )
  |> result.unwrap([])
}

/// 準備移動が長い観戦ルーム（隠れ CPU が歩き続ける）。
fn open_spectate() -> Subject(Message) {
  let spec =
    veryare.spectate_spec_with(
      RoomId("b"),
      SpectateSettings(3, 40, RandomLayout),
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
        max_spectators: 20,
        next_game_ms: 10_000,
        idle_close_ms: 60_000,
      )),
    )
  let assert Ok(Nil) = room_actor.start_game(started.data)
  started.data
}

fn watch(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
  outbox
}

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int

/// 短いフェーズの、人間 1 人と鬼 CPU の対戦のルーム（a が作って入る）。
fn open_match() -> #(Subject(Message), Subject(ServerMessage)) {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 30,
      painting_ms: 30,
      exploration_ms: 300,
      reveal_ms: 30,
      reload_ms: 3000,
    )
  let spec =
    veryare.spec_with(
      RoomId("m"),
      Settings(60, OniCpu, oni_cpu.Normal),
      durations,
      fn(_size) { 0 },
    )
  let assert Ok(started) = room_actor.start(spec)
  let a = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(started.data, Player(PlayerId("a"), "a"), a)
  #(started.data, a)
}

/// game-ended が届くまで読む（届いたものすべて）。
fn until_ended(
  outbox: Subject(ServerMessage),
  acc: List(ServerMessage),
) -> List(ServerMessage) {
  case process.receive(outbox, 3000) {
    Ok(GameEnded(..) as m) -> list.reverse([m, ..acc])
    Ok(m) -> until_ended(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

// --- 人間の対戦ルーム -----------------------------------------------------------------

/// 人間の対戦ルームでは、試合を結果まで回しても、観戦用の通知が一度も出ない。
pub fn match_room_never_sends_spectate_notices_test() {
  let #(room, a) = open_match()
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let got = until_ended(a, [])
  list.any(got, fn(m) {
    case m {
      GameEnded(..) -> True
      _ -> False
    }
  })
  |> should.be_true
  // 試合の中身（フェーズ・探索の開始の隠れ側の一括配信）は届いている。
  list.map(payloads(got), type_of) |> list.contains("hiders") |> should.be_true
  spectate_notices(got) |> should.equal([])
}

/// 対戦のルームに入る人は、参加者（観戦者にはならない）。試合が始まったら、途中から入れない。
pub fn spectators_cannot_enter_match_rooms_test() {
  let #(room, _) = open_match()
  let s = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("s"), "s"), s)
  let state = room_actor.snapshot(room)
  state.spectate |> should.be_false
  state.spectators |> should.equal(0)
  list.any(state.players, fn(p) { p.id == PlayerId("s") }) |> should.be_true
  // 鬼選出が済んで試合が進んだら、途中からは入れない。
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  process.sleep(150)
  room_actor.join_and_subscribe(
    room,
    Player(PlayerId("late"), "late"),
    process.new_subject(),
  )
  |> should.equal(Error(GameAlreadyStarted))
  room_actor.snapshot(room).spectators |> should.equal(0)
}

// --- 観戦ルーム -------------------------------------------------------------------

/// 参加者でも観戦者でもない接続には、観戦ルームでも、観戦用の通知が届かない（送信先を持たない）。
pub fn strangers_get_no_spectate_notices_test() {
  let room = open_spectate()
  let a = watch(room, "a")
  let stranger = process.new_subject()
  room_actor.subscribe(room, PlayerId("x"), stranger)
  room_actor.resync(room, PlayerId("x"))
  let to_a = drain(a, 400)
  { list.length(spectate_notices(to_a)) >= 2 } |> should.be_true
  drain(stranger, 0) |> should.equal([])
  room_actor.dissolve(room)
}

fn cell(x: Int, z: Int) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("x"), dynamic.int(x)),
    #(dynamic.string("z"), dynamic.int(z)),
  ])
}

fn move(x: Float, z: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
  ])
}

/// 観戦者の操作（移動・射撃・襖を開ける）は捨てられる。観戦者は、全員の一覧に載らず、試合は CPU だけで
/// 進む（隠れ CPU は誰も見つからない）。
pub fn spectator_actions_are_dropped_test() {
  let room = open_spectate()
  let a = watch(room, "a")
  let _ = drain(a, 50)
  room_actor.game_event(room, PlayerId("a"), move(1.0, 1.0))
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("shoot")),
      #(dynamic.string("target"), dynamic.string("cpu-2")),
    ]),
  )
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("open-door")),
      #(
        dynamic.string("door"),
        dynamic.properties([
          #(dynamic.string("a"), cell(1, 1)),
          #(dynamic.string("b"), cell(2, 1)),
        ]),
      ),
    ]),
  )
  let got = drain(a, 300)
  let notices = spectate_notices(got)
  { notices != [] } |> should.be_true
  list.each(notices, fn(n) {
    actor_ids(n) |> should.equal(["cpu-2", "cpu-3", "cpu-4"])
  })
  // 襖の状態・まだ隠れている人の一覧・結果は、観戦者の操作では変わらない。
  list.map(payloads(got), type_of)
  |> list.filter(fn(kind) { kind == "doors" || kind == "hiding" })
  |> should.equal([])
  room_actor.dissolve(room)
}
