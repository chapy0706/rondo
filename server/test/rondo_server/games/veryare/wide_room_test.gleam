//// 広い屋敷のルーム（issue-65 / ADR 0048）: ステージの値（2 = おまかせ、3 = 広い屋敷だけ）の受け口と、
//// 骨格に合わせたフェーズの長さ・ルーム情報（探索時間）の送り直し。
////
//// ルームの開始（spec の driver）を直接呼び、開始のときに全員へ送る物と、入り直した人へ本人宛てで送る物
//// （driver.subscribed）を見る。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{
  Mixed, NoCpu, RandomLayout, Settings, WideOnly,
} as veryare
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/stage_timing
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/driver.{type Effect, Broadcast, Deliver}
import rondo_server/room/room_actor.{type PlayerId, Player, PlayerId, RoomId}

// --- 補助 ---------------------------------------------------------------

fn raw(entries: List(#(String, Dynamic))) -> option.Option(Dynamic) {
  entries
  |> list.map(fn(entry) { #(dynamic.string(entry.0), entry.1) })
  |> dynamic.properties
  |> Some
}

fn settings() -> veryare.Settings {
  Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal)
}

/// 本番の長さ（探索 60 秒）。
fn production() -> game.Durations {
  game.durations(exploration_ms: 60_000)
}

/// ステージを選んだルームを、種 seed で開始する。開始のときの送信と、入り直した b への送信。
fn started(
  stage: veryare.StageChoice,
  durations: game.Durations,
  seed: Int,
) -> #(List(Effect(PlayerId)), List(Effect(PlayerId))) {
  let spec =
    veryare.spec_with_clock(
      RoomId("w"),
      settings(),
      stage,
      durations,
      fn(size) { seed % size },
      fn() { 0 },
    )
  let assert Some(start) = spec.driver
  let #(current, effects) = start([PlayerId("a"), PlayerId("b")])
  #(effects, driver.subscribed(current, PlayerId("b")))
}

fn payload_of(effect: Effect(PlayerId)) -> Result(Dynamic, Nil) {
  case effect {
    Broadcast(payload) | Deliver(_, payload) -> Ok(payload)
    _ -> Error(Nil)
  }
}

fn kind_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["type"], decode.string))
  |> option.from_result
  |> option.unwrap("")
}

/// ルーム情報の探索時間（届いた順）。
fn room_infos(effects: List(Effect(PlayerId))) -> List(Int) {
  effects
  |> list.filter_map(payload_of)
  |> list.filter(fn(p) { kind_of(p) == "room-info" })
  |> list.filter_map(fn(p) {
    decode.run(p, decode.at(["explorationSeconds"], decode.int))
    |> result_to_nil
  })
}

fn result_to_nil(r: Result(a, b)) -> Result(a, Nil) {
  case r {
    Ok(v) -> Ok(v)
    Error(_) -> Error(Nil)
  }
}

/// ステージの通知の幅（メートル）。
fn stage_width(effects: List(Effect(PlayerId))) -> Int {
  let assert Ok(width) =
    effects
    |> list.filter_map(payload_of)
    |> list.find(fn(p) { kind_of(p) == "stage" })
    |> result_to_nil
    |> fn(found) {
      case found {
        Ok(p) ->
          decode.run(p, decode.at(["width"], decode.int)) |> result_to_nil
        Error(Nil) -> Error(Nil)
      }
    }
  width
}

// --- ステージの値 ----------------------------------------------------------

/// 2 はおまかせ。3（広い屋敷だけ）は、RONDO_WIDE_DEV=1 のときだけ受け付ける。
pub fn wide_stage_values_are_read_test() {
  let normal = settings() |> fn(s) { Settings(..s, exploration_seconds: 40) }
  veryare.parse_room_with(raw([#("stage", dynamic.int(2))]), False)
  |> should.equal(Ok(#(normal, Mixed)))
  veryare.parse_room_with(raw([#("stage", dynamic.int(3))]), True)
  |> should.equal(Ok(#(normal, WideOnly)))
  // おまかせと広い屋敷だけは、CPU と一緒に選べる（平屋と違い、ランダム間取りの一種）。
  veryare.parse_room_with(
    raw([#("stage", dynamic.int(3)), #("cpu", dynamic.int(4))]),
    True,
  )
  |> should.be_ok
  // 既定（省略・0）は、これまでどおり、ふつうだけ。
  veryare.parse_room_with(None, True)
  |> should.equal(Ok(#(normal, RandomLayout)))
}

/// 3（広い屋敷だけ）は、RONDO_WIDE_DEV=1 でないとき、断られる。ルーム作成では invalid-settings
/// （catalog の InvalidSettings。session が invalid-settings に変える）。
pub fn wide_only_is_rejected_without_the_dev_flag_test() {
  veryare.parse_room_with(raw([#("stage", dynamic.int(3))]), False)
  |> should.be_error
  veryare.wide_dev(Error(Nil)) |> should.be_false
  veryare.wide_dev(Ok("0")) |> should.be_false
  veryare.wide_dev(Ok("true")) |> should.be_false
  veryare.wide_dev(Ok("1")) |> should.be_true
  veryare.wide_dev(Ok(" 1\n")) |> should.be_true
  veryare.wide_dev_env_name |> should.equal("RONDO_WIDE_DEV")
  // テストは RONDO_WIDE_DEV を立てずに流す（make verify）。立てて流したときは、受け付ける側を確かめる。
  let spec =
    catalog.spec_for(
      "veryare",
      RoomId("v"),
      raw([#("stage", dynamic.int(3))]),
      timing.Normal,
    )
  case veryare.wide_dev(get_env(veryare.wide_dev_env_name)) {
    False -> spec |> should.equal(Error(catalog.InvalidSettings))
    True -> spec |> should.be_ok |> fn(_) { Nil }
  }
  // おまかせは、旗が無くても受け付ける。
  catalog.spec_for(
    "veryare",
    RoomId("v"),
    raw([#("stage", dynamic.int(2))]),
    timing.Normal,
  )
  |> should.be_ok
}

// --- おまかせ（旗が下りている間） ---------------------------------------------

/// WIDE_READY が False の間、おまかせ（2）は 10 種だけを選ぶ。開始のときに送る物は、ふつうだけ（0）と
/// 同じで、ルーム情報は送り直さない。
pub fn mixed_picks_only_the_normal_ten_while_not_ready_test() {
  veryare.wide_ready |> should.be_false
  list.each([0, 1, 7, 42, 1234, 99_999, 2_147_483_646], fn(seed) {
    let #(mixed, mixed_resend) = started(Mixed, production(), seed)
    let #(normal, normal_resend) = started(RandomLayout, production(), seed)
    mixed |> should.equal(normal)
    mixed_resend |> should.equal(normal_resend)
    room_infos(mixed) |> should.equal([])
    room_infos(mixed_resend) |> should.equal([])
    { stage_width(mixed) < 20 } |> should.be_true
  })
}

// --- 広い屋敷のルーム -------------------------------------------------------

/// 広い屋敷だけ（3）のルームは、広い屋敷の地図を送り、ルーム情報を +80 秒で送り直す（開始のときに
/// 全員へ、入り直した人には本人宛てで）。ふつうの 10 種は、送り直さない。
pub fn wide_room_resends_room_info_test() {
  let #(effects, resend) = started(WideOnly, production(), 5)
  { stage_width(effects) >= 20 } |> should.be_true
  room_infos(effects) |> should.equal([60 + 80])
  let assert [Broadcast(first), ..] = effects
  kind_of(first) |> should.equal("room-info")
  // 入り直した人には、本人宛てで、先頭に（入室後の案内の 60 秒を上書きする）。
  room_infos(resend) |> should.equal([140])
  let assert [Deliver([PlayerId("b")], first_resend), ..] = resend
  kind_of(first_resend) |> should.equal("room-info")
  // ふつうの 10 種は、送り直さない（入室後の案内の 60 秒のまま）。
  let #(normal, normal_resend) = started(RandomLayout, production(), 5)
  room_infos(normal) |> should.equal([])
  room_infos(normal_resend) |> should.equal([])
}

/// 広い屋敷のフェーズの長さは、骨格に従う。準備移動は骨格から計算した秒数、探索は +80 秒。
/// 鬼選出・ペイント・答え合わせ・撃つ間隔は変えない。
pub fn wide_durations_follow_the_skeleton_test() {
  list.each(stage.wide_skeletons(), fn(skeleton) {
    let seconds = stage_timing.preparation_seconds(skeleton)
    { seconds >= 30 && seconds <= 50 && seconds % 5 == 0 } |> should.be_true
    let d = stage_timing.durations_for(production(), skeleton)
    d.preparation_ms |> should.equal(seconds * 1000)
    d.exploration_ms |> should.equal(140_000)
    d.oni_selection_ms |> should.equal(production().oni_selection_ms)
    d.painting_ms |> should.equal(production().painting_ms)
    d.reveal_ms |> should.equal(production().reveal_ms)
    d.reload_ms |> should.equal(production().reload_ms)
    stage_timing.exploration_seconds(skeleton, 40) |> should.equal(120)
    stage_timing.exploration_seconds(skeleton, 120) |> should.equal(200)
  })
}

/// テスト用の短縮（1/20）を当てはめた長さでも、同じ割合で縮む（ボットの時間の見積もりが崩れない）。
pub fn wide_durations_follow_the_test_divisor_test() {
  let faster = production() |> timing.apply(timing.Faster(20))
  list.each(stage.wide_skeletons(), fn(skeleton) {
    let seconds = stage_timing.preparation_seconds(skeleton)
    let d = stage_timing.durations_for(faster, skeleton)
    d.preparation_ms |> should.equal(seconds * 1000 / 20)
    d.exploration_ms |> should.equal(140_000 / 20)
  })
}

/// ふつうの 10 種は、準備移動 20 秒・探索はルームで選んだ時間のまま（渡された長さをそのまま返す）。
pub fn normal_ten_keep_their_durations_test() {
  list.each(stage.skeletons(), fn(skeleton) {
    stage_timing.preparation_seconds(skeleton) |> should.equal(20)
    stage_timing.exploration_seconds(skeleton, 40) |> should.equal(40)
    stage_timing.durations_for(production(), skeleton)
    |> should.equal(production())
    let d =
      stage_timing.durations_for(
        game.durations(exploration_ms: 40_000),
        skeleton,
      )
    d.preparation_ms |> should.equal(20_000)
    d.exploration_ms |> should.equal(40_000)
  })
}

/// 広い屋敷のルームの、準備移動のフェーズの通知の長さ（ルームを動かして、状態機械に渡った長さを見る）。
/// 鬼選出のカウントだけ短くし、準備移動は本番の 20 秒を渡す（広い屋敷では、骨格の秒数になる）。
pub fn wide_room_preparation_uses_the_skeleton_test() {
  let seed = 5
  let skeleton = stage.generate_wide(seed).skeleton
  let durations = game.Durations(..production(), oni_selection_ms: 30)
  let assert Ok(room) =
    room_actor.start(
      veryare.spec_with_clock(
        RoomId("w"),
        settings(),
        WideOnly,
        durations,
        fn(size) { seed % size },
        fn() { 0 },
      ),
    )
  let room = room.data
  let a = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("a"), "a"), a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let b = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("b"), "b"), b)
  // 入ってきた b には、入室後の案内（60 秒）の後に、+80 秒のルーム情報が届く。
  let joined = drain(b)
  room_infos_of(joined) |> should.equal([60, 140])
  stage_width_of(joined) |> should.equal(skeleton.width)
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ]),
  )
  wait_phase(b, "preparation", 40)
  |> should.equal(Some(stage_timing.preparation_seconds(skeleton) * 1000))
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

fn room_infos_of(payloads: List(Dynamic)) -> List(Int) {
  room_infos(list.map(payloads, Broadcast))
}

fn stage_width_of(payloads: List(Dynamic)) -> Int {
  stage_width(list.map(payloads, Broadcast))
}

/// phase のフェーズの通知が届くまで読む（tries 回まで）。届いた通知の長さ。
fn wait_phase(
  outbox: Subject(ServerMessage),
  phase: String,
  tries: Int,
) -> option.Option(Int) {
  case tries <= 0 {
    True -> None
    False -> {
      let found =
        drain(outbox)
        |> list.filter(fn(p) { kind_of(p) == "phase" })
        |> list.filter_map(fn(p) {
          case decode.run(p, decode.at(["phase"], decode.string)) {
            Ok(name) if name == phase ->
              decode.run(p, decode.at(["durationMs"], decode.int))
              |> result_to_nil
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

@external(erlang, "rondo_server_ffi", "get_env")
fn get_env(name: String) -> Result(String, Nil)
