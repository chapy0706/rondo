//// 移動の報告の向き（facing）の検査（issue-59）。数でない値は捨てて前の向きを保ち、数は -π〜π に
//// 巻き取る。待機ルームのメンバーの通知と、鬼の通知（同じ facings を使う）の両方に効く。
////
//// JSON で無限大・NaN は書けない（1e400・NaN・Infinity は、電文を読む段階で電文ごと捨てられる。
//// json_test で確かめる）。届きうる極端な値は、1e308 のような有限の大きな数と、文字列・null。

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, Settings} as veryare
import rondo_server/games/veryare/stage
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{type PlayerId, PlayerId, RoomId}

const pi = 3.141592653589793

fn durations() -> game.Durations {
  game.Durations(
    oni_selection_ms: 1000,
    preparation_ms: 2000,
    painting_ms: 3000,
    exploration_ms: 40_000,
    reveal_ms: 20_000,
    reload_ms: 3000,
  )
}

fn begin() -> Driver(PlayerId) {
  begin_with_spawn().0
}

/// 始めた driver と、ステージの通知の玄関の位置（鬼が探索の開始に現れる位置）。
fn begin_with_spawn() -> #(Driver(PlayerId), #(Float, Float)) {
  let spec =
    veryare.spec_with(
      RoomId("v"),
      Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
      durations(),
      fn(_size) { 0 },
    )
  let assert Some(factory) = spec.driver
  let #(started, effects) = factory([PlayerId("a"), PlayerId("b")])
  let assert [notice] = broadcast(effects, "stage")
  let assert Ok(spawn) =
    decode.run(notice, {
      use x <- decode.subfield(["spawn", "x"], number())
      use z <- decode.subfield(["spawn", "z"], number())
      decode.success(#(x, z))
    })
  #(started, spawn)
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])
}

fn move(x: Float, z: Float, facing: Dynamic) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
    #(dynamic.string("facing"), facing),
  ])
}

fn send(d: Driver(PlayerId), id: String, payload: Dynamic) {
  driver.event(d, PlayerId(id), payload)
}

fn timers(effects: List(Effect(PlayerId)), ms: Int) -> List(Int) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(wait, token) if wait == ms -> Ok(token)
      _ -> Error(Nil)
    }
  })
}

/// 送られた通知（全員宛て）のうち、type が kind のもの。
fn broadcast(effects: List(Effect(PlayerId)), kind: String) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(payload) ->
        case decode.run(payload, decode.at(["type"], decode.string)) {
          Ok(k) if k == kind -> Ok(payload)
          _ -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

/// a のメンバーの通知の、位置と向き（タイマーを起こして、送られたものを読む）。
fn member_a(
  d: Driver(PlayerId),
  effects: List(Effect(PlayerId)),
) -> #(Driver(PlayerId), #(Float, Float, option.Option(Float))) {
  let assert [token] = timers(effects, veryare.members_interval_ms)
  let #(d, woke) = driver.wake(d, token)
  let assert [payload] = broadcast(woke, "members")
  let decoder = {
    use x <- decode.field("x", decode.float)
    use z <- decode.field("z", decode.float)
    use facing <- decode.field("facing", decode.optional(decode.float))
    decode.success(#(x, z, facing))
  }
  let assert Ok([a, ..]) =
    decode.run(payload, decode.at(["members"], decode.list(decoder)))
  #(d, a)
}

fn within_pi(value: Float) -> Bool {
  value >. 0.0 -. pi -. 0.0001 && value <=. pi +. 0.0001
}

// --- 巻き取り（状態機械） -------------------------------------------------------------

/// 範囲内の通常の値は変わらない。π を超える値・-π を下回る値・極端に大きな値は、-π〜π に収まる。
pub fn wrap_angle_test() {
  game.wrap_angle(1.0) |> should.equal(1.0)
  game.wrap_angle(-2.5) |> should.equal(-2.5)
  game.wrap_angle(0.0) |> should.equal(0.0)
  let close = fn(a: Float, b: Float) {
    float.absolute_value(a -. b) <. 0.000001
  }
  close(game.wrap_angle(4.0), 4.0 -. 2.0 *. pi) |> should.be_true
  close(game.wrap_angle(-4.0), -4.0 +. 2.0 *. pi) |> should.be_true
  close(game.wrap_angle(7.0 *. pi), pi) |> should.be_true
  within_pi(game.wrap_angle(1.0e308)) |> should.be_true
  within_pi(game.wrap_angle(-1.0e308)) |> should.be_true
  within_pi(game.wrap_angle(1.7976931348623157e308)) |> should.be_true
}

/// 状態機械の向きは、巻き取ってから持つ。
pub fn turn_keeps_wrapped_facing_test() {
  let g = game.new(["a", "b"], durations(), stage_layout())
  let turned = game.turn(g, "a", 1.0e308)
  let assert Ok(facing) = dict.get(turned.facings, "a")
  within_pi(facing) |> should.be_true
  game.turn(g, "a", 1.0).facings |> dict.get("a") |> should.equal(Ok(1.0))
}

fn stage_layout() {
  stage.generate(1)
}

// --- メンバーの通知 ---------------------------------------------------------------

/// π を超える向き・極端に大きな向きは、メンバーの通知で -π〜π に収まる。通常の値は変わらない。
pub fn members_notice_facing_is_wrapped_test() {
  let d = begin()
  let #(d, moved) = send(d, "a", move(1.0, 0.5, dynamic.float(1.0)))
  let #(d, #(_, _, normal)) = member_a(d, moved)
  normal |> should.equal(Some(1.0))

  let #(d, moved) = send(d, "a", move(1.0, 0.5, dynamic.float(4.0)))
  let #(d, #(_, _, over)) = member_a(d, moved)
  // 4.0 - 2π ≈ -2.283 を、0.05 rad 単位に丸めた値。
  over |> should.equal(Some(-2.3))

  let #(d, moved) = send(d, "a", move(1.0, 0.5, dynamic.float(1.0e308)))
  let #(_, #(_, _, huge)) = member_a(d, moved)
  let assert Some(value) = huge
  within_pi(value) |> should.be_true
}

/// 数でない向き（文字列の "NaN"・null・真偽値）は捨てて、前の向きを保つ。位置は動く。
pub fn non_number_facing_keeps_previous_test() {
  let d = begin()
  let #(d, moved) = send(d, "a", move(1.0, 0.5, dynamic.float(1.0)))
  let #(d, _) = member_a(d, moved)
  list.each(
    [dynamic.string("NaN"), dynamic.nil(), dynamic.bool(True)],
    fn(facing) {
      let #(d2, moved) = send(d, "a", move(2.0, -1.0, facing))
      let #(_, #(x, z, kept)) = member_a(d2, moved)
      #(x, z) |> should.equal(#(2.0, -1.0))
      kept |> should.equal(Some(1.0))
    },
  )
}

// --- 鬼の通知 ---------------------------------------------------------------------

/// 人間の鬼の通知（探索中に動くたびに送る）でも、向きは -π〜π に収まり、数でない向きでは前の向きを保つ。
pub fn oni_notice_facing_is_wrapped_test() {
  let #(d, #(sx, sz)) = begin_with_spawn()
  // a がエリアに触れて立候補し、カウント・準備移動・ペイントのタイマーを起こして、探索へ進む。
  let #(d, touched) = send(d, "a", move(0.0, 0.0, dynamic.float(0.0)))
  let assert [count] = timers(touched, 1000)
  let #(d, selected) = driver.wake(d, count)
  let assert [prep] = timers(selected, 2000)
  let #(d, painted) = driver.wake(d, prep)
  let assert [paint] = timers(painted, 3000)
  let #(d, _) = driver.wake(d, paint)

  let #(d, moved) = send(d, "a", move(sx, sz -. 0.05, dynamic.float(4.0)))
  let facing_of = fn(effects) {
    let assert [payload] = broadcast(effects, "oni")
    let assert Ok(facing) =
      decode.run(payload, decode.at(["facing"], decode.float))
    facing
  }
  let first = facing_of(moved)
  { float.absolute_value(first -. { 4.0 -. 2.0 *. pi }) <. 0.000001 }
  |> should.be_true

  let #(d, moved) = send(d, "a", move(sx, sz -. 0.1, dynamic.float(1.0e308)))
  within_pi(facing_of(moved)) |> should.be_true

  let kept = facing_of(moved)
  // 数でない向きでは、前の向きのまま（位置だけ動いたので、鬼の通知は出る）。
  let #(_, moved) = send(d, "a", move(sx, sz -. 0.15, dynamic.string("NaN")))
  facing_of(moved) |> should.equal(kept)
}
