//// 観戦者の途中参加（issue-67 段階 ③）。ルーム（room_actor）を通して、先にいる観戦者 a と、あとから入る
//// 観戦者 b に届いた状態を比べる（参加者の組み合わせ表 join_snapshot_test の、観戦者の行）。
////
//// | 入るとき | b に届く種類 |
//// | 準備移動 | doors・phase・room-info・spectate・stage |
//// | 探索 | doors・hiders・hiding・oni・phase・room-info・spectate・stage |
//// | 答え合わせ | doors・hiders・hiding・oni・phase・room-info・spectate・stage |
//// | 結果 | doors・phase・room-info・spectate・stage（と game-ended） |
////
//// 中身（フェーズ・ステージ・隠れ側の一括配信・観戦用の通知に載る人）は、a に届いている最新と同じ。
//// 次の試合の始まりの行は、時刻を差し替えて箱を直接動かす spectate_feed_test で確かめる（ルームを
//// 通すと、試合ごとのフェーズの長さが同じなので、次の試合の準備移動だけを長くできない）。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None}
import gleam/result
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/room.{RandomLayout, SpectateSettings} as veryare
import rondo_server/protocol/message.{
  type ServerMessage, GameEnded, GameState, GameStateTo,
}
import rondo_server/room/room_actor.{
  type Message, Player, PlayerId, RoomId, Spectate, SpectateConfig,
}

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int

/// a が観戦者として入った観戦ルーム。
fn open(
  durations: game.Durations,
) -> #(Subject(Message), Subject(ServerMessage)) {
  let spec =
    veryare.spectate_spec_with(
      RoomId("j"),
      SpectateSettings(3, 40, RandomLayout),
      durations,
      fn(size) { 5 % size },
      monotonic_ms,
    )
  let assert Ok(started) =
    room_actor.start_with(
      spec,
      Spectate(SpectateConfig(
        max_spectators: 20,
        // 結果の行で、次の試合が始まらないように長くする。
        next_game_ms: 60_000,
        idle_close_ms: 60_000,
      )),
    )
  let a = watch(started.data, "a")
  let assert Ok(Nil) = room_actor.start_game(started.data)
  #(started.data, a)
}

fn watch(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
  outbox
}

fn durations(
  preparation_ms: Int,
  exploration_ms: Int,
  reveal_ms: Int,
) -> game.Durations {
  game.Durations(
    oni_selection_ms: 10_000,
    preparation_ms:,
    painting_ms: 30,
    exploration_ms:,
    reveal_ms:,
    reload_ms: 3000,
  )
}

fn payload_of(message: ServerMessage) -> Result(Dynamic, Nil) {
  case message {
    GameState(payload:, ..) | GameStateTo(payload:, ..) -> Ok(payload)
    _ -> Error(Nil)
  }
}

fn type_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["type"], decode.string))
  |> result.unwrap("?")
}

fn phase_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["phase"], decode.string))
  |> result.unwrap("?")
}

/// a に、フェーズ phase の通知（か、game-ended）が届くまで読む（届いたものすべて）。
fn until(
  outbox: Subject(ServerMessage),
  phase: String,
  acc: List(ServerMessage),
) -> List(ServerMessage) {
  case process.receive(outbox, 3000) {
    Ok(GameEnded(..) as m) if phase == "game-ended" -> list.reverse([m, ..acc])
    Ok(m) ->
      case payload_of(m) {
        Ok(p) if phase != "game-ended" ->
          case type_of(p) == "phase" && phase_of(p) == phase {
            True -> list.reverse([m, ..acc])
            False -> until(outbox, phase, [m, ..acc])
          }
        _ -> until(outbox, phase, [m, ..acc])
      }
    Error(Nil) -> list.reverse(acc)
  }
}

/// 少し待ってから、いま届いている分だけを読む。
fn drain(outbox: Subject(ServerMessage)) -> List(ServerMessage) {
  process.sleep(80)
  do_drain(outbox, [])
}

fn do_drain(outbox, acc) {
  case process.receive(outbox, 0) {
    Ok(m) -> do_drain(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn payloads(messages: List(ServerMessage)) -> List(Dynamic) {
  list.filter_map(messages, payload_of)
}

fn kinds(messages: List(ServerMessage)) -> List(String) {
  messages
  |> payloads
  |> list.map(type_of)
  |> list.unique
  |> list.sort(string.compare)
}

fn latest(messages: List(ServerMessage), kind: String) -> Result(Dynamic, Nil) {
  messages |> payloads |> list.filter(fn(p) { type_of(p) == kind }) |> list.last
}

fn actor_ids(notice: Dynamic) -> List(String) {
  decode.run(
    notice,
    decode.at(["actors"], decode.list(decode.at(["playerId"], decode.string))),
  )
  |> result.unwrap([])
}

fn has_looks(notice: Dynamic) -> Bool {
  decode.run(notice, decode.at(["looks"], decode.dynamic)) |> result.is_ok
}

/// b に届いたものが、a に届いている最新と同じか（種類ごと）。観戦用の通知は、載る人が同じで、b のものには
/// looks がある。
fn same_as(to_b: List(ServerMessage), to_a: List(ServerMessage)) -> Nil {
  let assert Ok(phase_b) = latest(to_b, "phase")
  let assert Ok(phase_a) = latest(to_a, "phase")
  phase_of(phase_b) |> should.equal(phase_of(phase_a))
  latest(to_b, "stage") |> should.equal(latest(to_a, "stage"))
  latest(to_b, "room-info") |> should.equal(latest(to_a, "room-info"))
  let assert Ok(spectate_b) = latest(to_b, "spectate")
  let assert Ok(spectate_a) = latest(to_a, "spectate")
  has_looks(spectate_b) |> should.be_true
  actor_ids(spectate_b) |> should.equal(actor_ids(spectate_a))
  // 隠れ側の一括配信は、探索中と答え合わせ中だけ届く（結果のときは届かない。これまでどおり）。
  case latest(to_b, "hiders") {
    Ok(hiders) -> latest(to_a, "hiders") |> should.equal(Ok(hiders))
    Error(Nil) -> Nil
  }
}

fn join_at(
  durations: game.Durations,
  phase: String,
) -> #(List(ServerMessage), List(ServerMessage)) {
  let #(room, a) = open(durations)
  let before = until(a, phase, [])
  let b = watch(room, "b")
  let to_b = drain(b)
  let to_a = list.append(before, drain(a))
  room_actor.dissolve(room)
  #(to_b, to_a)
}

pub fn spectator_joins_in_preparation_test() {
  let #(to_b, to_a) = join_at(durations(60_000, 60_000, 60_000), "preparation")
  kinds(to_b)
  |> should.equal(["doors", "phase", "room-info", "spectate", "stage"])
  same_as(to_b, to_a)
}

pub fn spectator_joins_in_exploration_test() {
  let #(to_b, to_a) = join_at(durations(30, 60_000, 60_000), "exploration")
  kinds(to_b)
  |> should.equal([
    "doors", "hiders", "hiding", "oni", "phase", "room-info", "spectate",
    "stage",
  ])
  let assert Ok(phase) = latest(to_b, "phase")
  phase_of(phase) |> should.equal("exploration")
  same_as(to_b, to_a)
}

pub fn spectator_joins_in_reveal_test() {
  let #(to_b, to_a) = join_at(durations(30, 30, 60_000), "reveal")
  kinds(to_b)
  |> should.equal([
    "doors", "hiders", "hiding", "oni", "phase", "room-info", "spectate",
    "stage",
  ])
  let assert Ok(phase) = latest(to_b, "phase")
  phase_of(phase) |> should.equal("reveal")
  same_as(to_b, to_a)
}

/// 答え合わせは、観戦用の通知の間隔（100 ms）より長くする（a に、答え合わせの全員の位置が届いてから、
/// 結果に入る）。
pub fn spectator_joins_at_the_result_test() {
  let #(to_b, to_a) = join_at(durations(30, 30, 300), "game-ended")
  kinds(to_b)
  |> should.equal(["doors", "phase", "room-info", "spectate", "stage"])
  let assert Ok(phase) = latest(to_b, "phase")
  phase_of(phase) |> should.equal("ended")
  // 結果も、閉じるまでの残りなしで届く（観戦ルームは、時間で閉じない）。
  let assert Ok(GameEnded(closes_in_ms:, ..)) =
    list.find(to_b, fn(m) {
      case m {
        GameEnded(..) -> True
        _ -> False
      }
    })
  closes_in_ms |> should.equal(None)
  same_as(to_b, to_a)
}
