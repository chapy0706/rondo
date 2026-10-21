//// 観戦用の通知の送り方（issue-67 段階 ③）。veryare の観戦ルームの箱を、時刻を差し替えて直接動かす。
////
//// - 試合の最初の 1 通（作成・次の試合の始まり）に、全員の色とポーズ（looks）を載せる
//// - 100 ms ごとに起き、全員の位置・向き・ポーズが前に送ったものと変わったときだけ、観戦者に送る
//// - 古い試合・古いフェーズのタイマーは、効かない。結果（終了）に入ったら止まる
//// - 観戦用の通知は、観戦者だけへの指示（ToSpectators）で出す（全員宛ての配信に混ぜない）
////
//// 届ける状態の一覧（subscriber_snapshot）の、観戦者の行。観戦者の入室・復帰で、いまの状態（フェーズ・
//// ステージ・襖・観戦用の通知の最新、探索中と答え合わせ中なら、隠れ側の一括配信と鬼の通知）が届き、
//// 中身は、そこまでに配信されたものの最新と同じ。
////
//// | フェーズ | 届く種類 |
//// | 準備移動 | doors・phase・spectate・stage |
//// | 探索 | doors・hiders・hiding・oni・phase・spectate・stage |
//// | 答え合わせ | doors・hiders・hiding・oni・phase・spectate・stage |
//// | 結果 | doors・phase・spectate・stage |
//// | 次の試合の始まり | doors・phase・spectate・stage |

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/list
import gleam/option.{Some}
import gleam/result
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/room.{RandomLayout, SpectateSettings} as veryare
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{type PlayerId, PlayerId, RoomId}

@external(erlang, "rondo_spectate_test_ffi", "set_clock")
fn set_clock(ms: Int) -> Nil

@external(erlang, "rondo_spectate_test_ffi", "clock")
fn clock() -> Int

const preparation_ms = 20_000

fn durations() -> game.Durations {
  game.Durations(
    oni_selection_ms: 10_000,
    preparation_ms:,
    painting_ms: 20_000,
    exploration_ms: 40_000,
    reveal_ms: 20_000,
    reload_ms: 3000,
  )
}

type Step =
  #(Driver(PlayerId), List(Effect(PlayerId)))

/// 時刻 0 で、観戦ルームの最初の試合を始める（準備移動から）。
fn begin() -> Step {
  set_clock(0)
  let spec =
    veryare.spectate_spec_with(
      RoomId("f"),
      SpectateSettings(3, 40, RandomLayout),
      durations(),
      fn(size) { 5 % size },
      clock,
    )
  let assert Some(start) = spec.driver
  start(list.map(spec.bots, fn(p) { p.id }))
}

fn type_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["type"], decode.string))
  |> result.unwrap("?")
}

/// 観戦者だけへの指示（観戦用の通知）。
fn to_spectators(effects: List(Effect(PlayerId))) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.ToSpectators(payload) -> Ok(payload)
      _ -> Error(Nil)
    }
  })
}

/// 全員宛ての配信。
fn broadcasts(effects: List(Effect(PlayerId))) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(payload) -> Ok(payload)
      _ -> Error(Nil)
    }
  })
}

fn timers(effects: List(Effect(PlayerId))) -> List(#(Int, Int)) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(ms:, token:) -> Ok(#(ms, token))
      _ -> Error(Nil)
    }
  })
}

/// 観戦用の通知のタイマー（ほかのタイマーより、ずっと下の token）。
fn spectate_timers(effects: List(Effect(PlayerId))) -> List(#(Int, Int)) {
  list.filter(timers(effects), fn(t) { t.1 <= -3_000_000 })
}

/// フェーズのタイマーの token（0 以上）。
fn phase_token(effects: List(Effect(PlayerId))) -> Int {
  let assert Ok(#(_, token)) = list.find(timers(effects), fn(t) { t.1 >= 0 })
  token
}

fn spectate_token(effects: List(Effect(PlayerId))) -> Int {
  let assert [#(_, token)] = spectate_timers(effects)
  token
}

fn has_looks(payload: Dynamic) -> Bool {
  decode.run(payload, decode.at(["looks"], decode.dynamic)) |> result.is_ok
}

fn actors_of(payload: Dynamic) -> Dynamic {
  let assert Ok(actors) =
    decode.run(payload, decode.at(["actors"], decode.dynamic))
  actors
}

fn phase_of(payload: Dynamic) -> String {
  decode.run(payload, decode.at(["phase"], decode.string))
  |> result.unwrap("?")
}

// --- 送り方 ------------------------------------------------------------------------

/// 試合の最初の 1 通は、観戦者だけへの指示で、全員の色とポーズ（looks）を載せる。100 ms のタイマーを張る。
pub fn first_notice_carries_looks_test() {
  let #(_, effects) = begin()
  let assert [first] = to_spectators(effects)
  type_of(first) |> should.equal("spectate")
  has_looks(first) |> should.be_true
  let assert Ok(looks) =
    decode.run(first, decode.at(["looks"], decode.list(decode.dynamic)))
  list.length(looks) |> should.equal(3)
  // 全員宛ての配信には、観戦用の通知を混ぜない。
  broadcasts(effects)
  |> list.any(fn(p) { type_of(p) == "spectate" })
  |> should.be_false
  let assert [#(ms, _)] = spectate_timers(effects)
  ms |> should.equal(veryare.spectate_interval_ms)
  veryare.spectate_interval_ms |> should.equal(100)
}

/// 起きるたびに、変わっていれば送り（looks は載せない）、同じなら送らない。どちらでも、次の 100 ms を張る。
pub fn notices_go_out_only_when_something_changed_test() {
  let #(d, effects) = begin()
  let token = spectate_token(effects)
  // 300 ms たつと、歩いている隠れ CPU が進んでいる。
  set_clock(300)
  let #(d, effects) = driver.wake(d, token)
  let assert [moved] = to_spectators(effects)
  has_looks(moved) |> should.be_false
  spectate_timers(effects) |> should.equal([#(100, token)])
  // 時刻が同じなら、変わっていないので送らない。
  let #(d, effects) = driver.wake(d, token)
  to_spectators(effects) |> should.equal([])
  spectate_timers(effects) |> should.equal([#(100, token)])
  // 全員が着いた後（準備移動の終わり）は、一度送ったら、あとは送らない。
  set_clock(preparation_ms)
  let #(d, effects) = driver.wake(d, token)
  list.length(to_spectators(effects)) |> should.equal(1)
  set_clock(preparation_ms + 100)
  let #(_, effects) = driver.wake(d, token)
  to_spectators(effects) |> should.equal([])
}

/// フェーズが進むと、新しい token で張り直す。古い token のタイマーは、何もしない。
pub fn stale_spectate_timers_are_ignored_test() {
  let #(d, effects) = begin()
  let old = spectate_token(effects)
  let #(d, effects) = driver.wake(d, phase_token(effects))
  phase_of(list.first(broadcasts(effects)) |> result.unwrap(dynamic.nil()))
  |> should.equal("painting")
  let new = spectate_token(effects)
  { new != old } |> should.be_true
  set_clock(500)
  let #(_, effects) = driver.wake(d, old)
  effects |> should.equal([])
}

/// 結果（終了）に入ったら、観戦用の通知のタイマーを張らない。
pub fn notices_stop_at_the_result_test() {
  let #(_, effects) = to_ended()
  spectate_timers(effects) |> should.equal([])
}

/// 次の試合の最初の 1 通にも、色とポーズを載せる。タイマーの token は、前の試合と重ならない。
pub fn next_game_starts_with_looks_again_test() {
  let #(first, first_effects) = begin()
  let assert Ok(#(_, effects)) = driver.restart(first)
  let assert [notice] = to_spectators(effects)
  has_looks(notice) |> should.be_true
  { spectate_token(effects) != spectate_token(first_effects) }
  |> should.be_true
}

// --- 届ける状態の一覧（観戦者の行） -----------------------------------------------------

/// いま観戦者に届いているもの（配信と観戦者だけへの指示を、順に並べたもの）。
type Seen =
  List(Dynamic)

fn seen(before: Seen, effects: List(Effect(PlayerId))) -> Seen {
  list.append(
    before,
    list.filter_map(effects, fn(effect) {
      case effect {
        driver.Broadcast(payload) | driver.ToSpectators(payload) -> Ok(payload)
        _ -> Error(Nil)
      }
    }),
  )
}

fn latest(payloads: Seen, kind: String) -> Result(Dynamic, Nil) {
  payloads |> list.filter(fn(p) { type_of(p) == kind }) |> list.last
}

/// 観戦者 s の入室・復帰で届くもの（本人宛て）。
fn snapshot(d: Driver(PlayerId)) -> List(Dynamic) {
  driver.subscribed(d, PlayerId("s"))
  |> list.map(fn(effect) {
    let assert driver.Deliver([PlayerId("s")], payload) = effect
    payload
  })
}

fn kinds(payloads: List(Dynamic)) -> List(String) {
  payloads |> list.map(type_of) |> list.unique |> list.sort(string.compare)
}

/// 観戦用の通知の時計を進めて起こし、最新を送らせる（フェーズが替わったばかりの全員の位置）。
fn tick(step: Step, seen_so_far: Seen) -> #(Step, Seen) {
  let #(d, effects) = step
  set_clock(clock() + 100)
  let #(d, woke) = driver.wake(d, spectate_token(effects))
  #(#(d, list.append(effects, woke)), seen(seen_so_far, woke))
}

/// 入室で届いたものは、そこまでに観戦者へ届いたものの最新と同じ（種類ごと）。観戦用の通知は、全員の
/// 位置が同じで、looks が足してある。
fn matches_latest(snap: List(Dynamic), seen_so_far: Seen) -> Nil {
  list.each(snap, fn(payload) {
    case type_of(payload) {
      "spectate" -> {
        has_looks(payload) |> should.be_true
        let assert Ok(last) = latest(seen_so_far, "spectate")
        actors_of(payload) |> should.equal(actors_of(last))
      }
      // フェーズの通知の長さは、入室の時点からの残り（ADR 0046）なので、フェーズだけを比べる。
      "phase" -> {
        let assert Ok(last) = latest(seen_so_far, "phase")
        phase_of(payload) |> should.equal(phase_of(last))
      }
      // まだ隠れている人の一覧は、CPU だけの試合では最初から変わらないので、全員宛てには送っていない。
      // 隠れ CPU の全員が載る。
      "hiding" ->
        decode.run(
          payload,
          decode.at(["playerIds"], decode.list(decode.string)),
        )
        |> should.equal(Ok(["cpu-2", "cpu-3", "cpu-4"]))
      kind -> {
        let assert Ok(last) = latest(seen_so_far, kind)
        payload |> should.equal(last)
      }
    }
  })
}

fn next_phase(step: Step, seen_so_far: Seen) -> #(Step, Seen) {
  let #(d, effects) = step
  let #(d, next) = driver.wake(d, phase_token(effects))
  #(#(d, next), seen(seen_so_far, next))
}

fn to_ended() -> Step {
  let started = begin()
  let #(step, _) = next_phase(started, [])
  let #(step, _) = next_phase(step, [])
  let #(step, _) = next_phase(step, [])
  let #(step, _) = next_phase(step, [])
  step
}

pub fn spectator_joining_in_preparation_gets_current_state_test() {
  let #(d, effects) = begin()
  let snap = snapshot(d)
  kinds(snap) |> should.equal(["doors", "phase", "spectate", "stage"])
  let assert Ok(phase) = latest(snap, "phase")
  phase_of(phase) |> should.equal("preparation")
  matches_latest(snap, seen([], effects))
}

pub fn spectator_joining_in_exploration_gets_current_state_test() {
  let started = begin()
  let #(_, start_effects) = started
  let all = seen([], start_effects)
  let #(step, all) = next_phase(started, all)
  let #(step, all) = next_phase(step, all)
  let #(#(d, _), all) = tick(step, all)
  let snap = snapshot(d)
  kinds(snap)
  |> should.equal([
    "doors", "hiders", "hiding", "oni", "phase", "spectate", "stage",
  ])
  let assert Ok(phase) = latest(snap, "phase")
  phase_of(phase) |> should.equal("exploration")
  matches_latest(list.filter(snap, fn(p) { type_of(p) != "oni" }), all)
}

pub fn spectator_joining_in_reveal_gets_current_state_test() {
  let started = begin()
  let #(_, start_effects) = started
  let all = seen([], start_effects)
  let #(step, all) = next_phase(started, all)
  let #(step, all) = next_phase(step, all)
  let #(step, all) = next_phase(step, all)
  let #(#(d, _), all) = tick(step, all)
  let snap = snapshot(d)
  kinds(snap)
  |> should.equal([
    "doors", "hiders", "hiding", "oni", "phase", "spectate", "stage",
  ])
  let assert Ok(phase) = latest(snap, "phase")
  phase_of(phase) |> should.equal("reveal")
  matches_latest(list.filter(snap, fn(p) { type_of(p) != "oni" }), all)
}

pub fn spectator_joining_at_the_result_gets_current_state_test() {
  let started = begin()
  let #(_, start_effects) = started
  let all = seen([], start_effects)
  let #(step, all) = next_phase(started, all)
  let #(step, all) = next_phase(step, all)
  let #(step, all) = next_phase(step, all)
  // 答え合わせの最新の位置を送らせてから、結果に入る。
  let #(step, all) = tick(step, all)
  let #(#(d, _), all) = next_phase(step, all)
  let snap = snapshot(d)
  kinds(snap) |> should.equal(["doors", "phase", "spectate", "stage"])
  let assert Ok(phase) = latest(snap, "phase")
  phase_of(phase) |> should.equal("ended")
  matches_latest(snap, all)
}

pub fn spectator_joining_at_the_next_game_gets_current_state_test() {
  let #(ended, _) = to_ended()
  let assert Ok(#(d, effects)) = driver.restart(ended)
  let snap = snapshot(d)
  kinds(snap) |> should.equal(["doors", "phase", "spectate", "stage"])
  let assert Ok(phase) = latest(snap, "phase")
  phase_of(phase) |> should.equal("preparation")
  // 次の試合の始まりに配信したもの（ステージ・襖・フェーズ・最初の 1 通）と同じ。
  matches_latest(snap, seen([], effects))
}
