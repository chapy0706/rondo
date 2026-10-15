//// 購読者に、いま届けるべき状態（参加・復帰の送り直し）。room_actor を通して、2 人目の人間に届く
//// 通知の種類と中身を、CPU の有無で比べる。
////
//// 不具合: ランダム間取りで CPU を加えたルームに 2 人目が入ると、フェーズの通知（エリアの色を含む）が
//// 2 人目に届かず、移動パッドと鬼希望エリアの円が出なかった。CPU を人数に数えるのでエリアは最初から
//// 緑で、2 人目の参加で全員への通知が出ず、本人宛ての送り直しにもフェーズが無かった。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{type Option, Some}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{
  type CpuChoice, HiderCpus, NoCpu, OniCpu, Settings,
} as veryare
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/room_actor.{type Message, Player, PlayerId, RoomId}

fn durations() -> game.Durations {
  game.Durations(
    oni_selection_ms: 10_000,
    preparation_ms: 20_000,
    painting_ms: 20_000,
    exploration_ms: 40_000,
    reveal_ms: 20_000,
    reload_ms: 3000,
  )
}

/// a が作って入り（作成と同時に始まる）、送信先を持つルーム。
fn open(cpu: CpuChoice) -> #(Subject(Message), Subject(ServerMessage)) {
  let assert Ok(started) =
    room_actor.start(
      veryare.spec_with(
        RoomId("j"),
        Settings(exploration_seconds: 60, cpu:, strength: oni_cpu.Normal),
        durations(),
        fn(_size) { 0 },
      ),
    )
  let a = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(started.data, Player(PlayerId("a"), "a"), a)
  let assert Ok(Nil) = room_actor.start_game(started.data)
  #(started.data, a)
}

fn join(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
  outbox
}

/// 届いたゲームの通知（全員宛て・本人宛て）の中身。時間内に無くなるまで読む。
fn drain(outbox: Subject(ServerMessage)) -> List(Dynamic) {
  case process.receive(outbox, 300) {
    Ok(GameState(payload:, ..)) | Ok(GameStateTo(payload:, ..)) -> [
      payload,
      ..drain(outbox)
    ]
    Ok(_) -> drain(outbox)
    Error(Nil) -> []
  }
}

fn type_of(payload: Dynamic) -> String {
  case decode.run(payload, decode.at(["type"], decode.string)) {
    Ok(kind) -> kind
    Error(_) -> "?"
  }
}

/// 届いた通知の種類（重ねず、名前の順）。
fn kinds(payloads: List(Dynamic)) -> List(String) {
  payloads |> list.map(type_of) |> list.unique |> list.sort(string.compare)
}

/// 最後に届いたフェーズの通知の、フェーズ・エリア・鬼。届いていなければ None。
fn last_phase(
  payloads: List(Dynamic),
) -> Option(#(String, Option(String), Option(String))) {
  let decoder = {
    use phase <- decode.field("phase", decode.string)
    use area <- decode.field("area", decode.optional(decode.string))
    use oni <- decode.field("oni", decode.optional(decode.string))
    decode.success(#(phase, area, oni))
  }
  payloads
  |> list.filter(fn(p) { type_of(p) == "phase" })
  |> list.last
  |> option.from_result
  |> option.then(fn(p) { decode.run(p, decoder) |> option.from_result })
}

/// 鬼選出の間に入った人に届く、いまの状態の種類。
const waiting_kinds = ["doors", "members", "phase", "room-info", "stage"]

/// 2 人目に、CPU なしのルームと同じ種類の通知（フェーズ・エリア・メンバー・ルーム情報・ステージ・襖）が届き、
/// フェーズの中身（フェーズ・エリアの色・鬼）は、1 人目が持っているものと同じ。
fn second_joiner_matches_first(cpu: CpuChoice) -> Nil {
  let #(room, a) = open(cpu)
  let b = join(room, "b")
  let to_b = drain(b)
  let to_a = drain(a)
  kinds(to_b) |> should.equal(waiting_kinds)
  let assert Some(#(phase, area, _)) = last_phase(to_b)
  phase |> should.equal("oni-selection")
  area |> should.equal(Some("ready"))
  last_phase(to_b) |> should.equal(last_phase(to_a))
}

pub fn second_joiner_without_cpu_gets_current_state_test() {
  second_joiner_matches_first(NoCpu)
}

pub fn second_joiner_with_hider_cpu_gets_current_state_test() {
  second_joiner_matches_first(HiderCpus(1))
}

pub fn second_joiner_with_two_hider_cpus_gets_current_state_test() {
  second_joiner_matches_first(HiderCpus(2))
}

pub fn second_joiner_with_oni_cpu_gets_current_state_test() {
  second_joiner_matches_first(OniCpu)
}

/// 3 人目にも、同じ種類・同じフェーズの中身が届く。
pub fn third_joiner_gets_current_state_test() {
  let #(room, a) = open(HiderCpus(1))
  let _ = join(room, "b")
  let c = join(room, "c")
  let to_c = drain(c)
  kinds(to_c) |> should.equal(waiting_kinds)
  last_phase(to_c) |> should.equal(last_phase(drain(a)))
}

/// 2 人目が復帰（再接続の resync）したときに届く種類と中身は、参加したときと同じ。
fn resync_matches_join(cpu: CpuChoice) -> Nil {
  let #(room, _) = open(cpu)
  let b = join(room, "b")
  let joined = drain(b)
  room_actor.resync(room, PlayerId("b"))
  let again = drain(b)
  kinds(again) |> should.equal(kinds(joined))
  last_phase(again) |> should.equal(last_phase(joined))
}

pub fn resync_without_cpu_matches_join_test() {
  resync_matches_join(NoCpu)
}

pub fn resync_with_hider_cpu_matches_join_test() {
  resync_matches_join(HiderCpus(1))
}

pub fn resync_with_oni_cpu_matches_join_test() {
  resync_matches_join(OniCpu)
}

/// 作った人（1 人目）が復帰したときも、いまのフェーズとエリアが届く。
pub fn creator_resync_gets_phase_test() {
  let #(room, a) = open(HiderCpus(1))
  let before = drain(a)
  room_actor.resync(room, PlayerId("a"))
  let again = drain(a)
  kinds(again) |> should.equal(waiting_kinds)
  last_phase(again) |> should.equal(last_phase(before))
}

/// 参加者でない接続の resync には、何も届かない（情報が漏れる経路を作らない）。
pub fn stranger_resync_gets_nothing_test() {
  let #(room, _) = open(HiderCpus(1))
  let stranger = process.new_subject()
  room_actor.subscribe(room, PlayerId("x"), stranger)
  room_actor.resync(room, PlayerId("x"))
  drain(stranger) |> should.equal([])
}
