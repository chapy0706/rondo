//// 動ける隠れ側の規則（ADR 0053）のルーム。設定の読み取り、ルーム情報、動く隠れ側の通知（120 ms の
//// タイマー・変わったときだけ）、見た目の通知、送り直し、そして従来の規則のルームでは、どれも出ないこと。
////
//// driver を直接動かし、タイマー（WakeAfter）を手で起こす。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/games/veryare/game
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/roaming
import rondo_server/games/veryare/room.{NoCpu, RandomLayout, Rules, Settings} as veryare
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{type PlayerId, PlayerId, RoomId}

// --- 補助 ---------------------------------------------------------------

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

fn spec(roaming: Bool) -> room_actor.RoomSpec {
  veryare.spec_with_rules(
    RoomId("v"),
    Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
    RandomLayout,
    Rules(roaming:, spreading: False),
    durations(),
    fn(_size) { 0 },
    fn() { 0 },
  )
}

type Step =
  #(Driver(PlayerId), List(Effect(PlayerId)))

fn begin(roaming: Bool) -> Step {
  let assert Some(factory) = spec(roaming).driver
  factory([PlayerId("a"), PlayerId("b"), PlayerId("c")])
}

fn move_payload(x: Float, z: Float, facing: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
    #(dynamic.string("facing"), dynamic.float(facing)),
  ])
}

fn paint_payload(color: String, pose: String) -> Dynamic {
  let stroke =
    dynamic.properties([
      #(dynamic.string("part"), dynamic.string("torso")),
      #(dynamic.string("color"), dynamic.string(color)),
      #(dynamic.string("size"), dynamic.float(0.05)),
      #(
        dynamic.string("points"),
        dynamic.list([
          dynamic.properties([
            #(dynamic.string("u"), dynamic.float(0.5)),
            #(dynamic.string("v"), dynamic.float(0.5)),
          ]),
        ]),
      ),
    ])
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("paint")),
    #(
      dynamic.string("paint"),
      dynamic.properties([
        #(dynamic.string("kind"), dynamic.string("strokes")),
        #(dynamic.string("strokes"), dynamic.list([stroke])),
      ]),
    ),
    #(dynamic.string("pose"), dynamic.string(pose)),
  ])
}

fn send(d: Driver(PlayerId), id: String, payload: Dynamic) -> Step {
  driver.event(d, PlayerId(id), payload)
}

/// フェーズのタイマー（0 以上の token）。
fn phase_timer(effects: List(Effect(PlayerId))) -> Int {
  let assert Ok(token) =
    list.find_map(effects, fn(effect) {
      case effect {
        driver.WakeAfter(_, token) if token >= 0 -> Ok(token)
        _ -> Error(Nil)
      }
    })
  token
}

/// 動く隠れ側の通知のタイマー（120 ms）の token。
fn roaming_timers(effects: List(Effect(PlayerId))) -> List(Int) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(ms, token) if ms == veryare.roaming_interval_ms ->
        Ok(token)
      _ -> Error(Nil)
    }
  })
}

fn type_of(payload: Dynamic) -> String {
  case decode.run(payload, decode.at(["type"], decode.string)) {
    Ok(kind) -> kind
    Error(_) -> "?"
  }
}

/// 全員宛て・本人宛ての payload のうち、種類が kind のもの。
fn payloads(effects: List(Effect(PlayerId)), kind: String) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(payload) | driver.Deliver(_, payload) ->
        case type_of(payload) == kind {
          True -> Ok(payload)
          False -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

/// a が鬼希望エリアに入り、鬼選出・準備移動（b・c は別々の場所へ）を経て、ペイントの始まりまで。
/// 途中の効果もすべて返す。
fn to_painting(roaming: Bool) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let #(d, e0) = begin(roaming)
  let #(d, e1) = send(d, "a", move_payload(0.0, 0.0, 0.0))
  let #(d, e2) = driver.wake(d, phase_timer(e1))
  let layout = stage.generate(0)
  let assert [#(bx, bz), #(cx, cz)] =
    spread.spots(grid.of_layout(layout), layout.skeleton.spawn, 2, 7.0)
  let #(d, _) = send(d, "b", move_payload(bx, bz, 0.0))
  let #(d, _) = send(d, "c", move_payload(cx, cz, 0.0))
  let #(d, e3) = driver.wake(d, phase_timer(e2))
  #(d, list.flatten([e0, e1, e2, e3]))
}

/// 効果の中の、最後のフェーズのタイマー。
fn last_phase_timer(effects: List(Effect(PlayerId))) -> Int {
  phase_timer(list.reverse(effects))
}

fn to_exploration(
  roaming: Bool,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let #(d, before) = to_painting(roaming)
  let #(d, e) = driver.wake(d, last_phase_timer(before))
  #(d, list.append(before, e))
}

/// b のいまの位置（ペイントの始まりに、b が動いた先）。
fn b_spot() -> #(Float, Float) {
  let layout = stage.generate(0)
  let assert [spot, _] =
    spread.spots(grid.of_layout(layout), layout.skeleton.spawn, 2, 7.0)
  spot
}

// --- 設定とルーム情報 ---------------------------------------------------------

fn settings(fields: List(#(String, Dynamic))) -> option.Option(Dynamic) {
  Some(
    dynamic.properties(
      list.map(fields, fn(pair) { #(dynamic.string(pair.0), pair.1) }),
    ),
  )
}

/// roaming は省略すると既定（従来）。0 は従来、1 は動ける隠れ側。ほかの値は拒む。
pub fn rules_are_parsed_test() {
  veryare.default_roaming |> should.equal(0)
  veryare.parse_rules(None)
  |> should.equal(Ok(Rules(roaming: False, spreading: False)))
  veryare.parse_rules(settings([]))
  |> should.equal(Ok(Rules(roaming: False, spreading: False)))
  veryare.parse_rules(settings([#("roaming", dynamic.int(0))]))
  |> should.equal(Ok(Rules(roaming: False, spreading: False)))
  veryare.parse_rules(settings([#("roaming", dynamic.int(1))]))
  |> should.equal(Ok(Rules(roaming: True, spreading: False)))
  veryare.parse_rules(settings([#("roaming", dynamic.int(2))]))
  |> should.equal(Error(Nil))
  veryare.parse_rules(settings([#("roaming", dynamic.string("1"))]))
  |> should.equal(Error(Nil))
}

/// 作成の入口は、規則を読んでルームを作り、選択肢にない値を断る。
pub fn catalog_reads_the_rules_test() {
  let ok =
    catalog.room_for(
      "veryare",
      RoomId("v"),
      settings([#("roaming", dynamic.int(1))]),
      timing.Normal,
    )
  let assert Ok(#(created, _, _)) = ok
  created.member_info |> option.map(roaming_flag) |> should.equal(Some(True))
  catalog.room_for(
    "veryare",
    RoomId("v"),
    settings([#("roaming", dynamic.int(3))]),
    timing.Normal,
  )
  |> should.equal(Error(catalog.InvalidSettings))
}

fn roaming_flag(info: Dynamic) -> Bool {
  case decode.run(info, decode.at(["roaming"], decode.bool)) {
    Ok(value) -> value
    Error(_) -> False
  }
}

/// ルーム情報: 動ける規則なら roaming: true。従来の規則では、これまでと同じ形（roaming を載せない）。
pub fn room_info_tells_the_rules_test() {
  let assert Some(info) = spec(True).member_info
  roaming_flag(info) |> should.be_true
  let assert Some(classic) = spec(False).member_info
  decode.run(classic, decode.at(["roaming"], decode.bool))
  |> should.be_error
  classic
  |> should.equal(
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("room-info")),
      #(dynamic.string("explorationSeconds"), dynamic.int(60)),
    ]),
  )
}

// --- 動く隠れ側の通知 --------------------------------------------------------

/// 探索の開始で、動く隠れ側の通知のタイマーを張り、起きたら全員へ送る。
pub fn roaming_notice_is_sent_after_exploration_starts_test() {
  let #(d, effects) = to_exploration(True)
  let assert [token] = roaming_timers(effects)
  let #(_, woke) = driver.wake(d, token)
  let assert [notice] = payloads(woke, "roaming")
  let assert Ok([hider, _]) = roaming.decode_notice(notice)
  hider.player_id |> should.equal("b")
  hider.facing |> should.equal(Some(0.0))
}

/// 動いたら（変わったときだけ）タイマーを張り、新しい位置と向きを送る。動かなければ張らない。
pub fn roaming_notice_follows_moves_test() {
  let #(d, effects) = to_exploration(True)
  let #(sx, sz) = b_spot()
  let assert [token] = roaming_timers(effects)
  let #(d, _) = driver.wake(d, token)
  let #(d, moved) = send(d, "b", move_payload(sx +. 0.2, sz, 1.0))
  let assert [again] = roaming_timers(moved)
  // 張っている間は、重ねて張らない。
  let #(d, more) = send(d, "b", move_payload(sx +. 0.3, sz, 1.0))
  roaming_timers(more) |> should.equal([])
  let #(d, woke) = driver.wake(d, again)
  let assert [notice] = payloads(woke, "roaming")
  let assert Ok([hider, _]) = roaming.decode_notice(notice)
  hider.x |> should.equal(sx +. 0.3)
  hider.facing |> should.equal(Some(1.0))
  // 同じ位置の報告では、張らない。
  let #(_, same) = send(d, "b", move_payload(sx +. 0.3, sz, 1.0))
  roaming_timers(same) |> should.equal([])
}

/// 探索の間の見た目の更新は、その場で全員へ送る。ペイントの間は送らず、探索の開始の一括配信に載る。
pub fn looks_are_broadcast_only_while_exploring_test() {
  let #(d, before) = to_painting(True)
  let #(d, painted) = send(d, "b", paint_payload("#112233", "idle"))
  payloads(painted, "look") |> should.equal([])
  // 探索の開始の一括配信に、ペイントの間の見た目が載る。
  let #(d, explored) = driver.wake(d, last_phase_timer(before))
  let assert [hiders] = payloads(explored, "hiders")
  decode.run(
    hiders,
    decode.at(
      ["hiders"],
      decode.list(decode.at(["pose"], decode.optional(decode.string))),
    ),
  )
  |> should.equal(Ok([Some("idle"), None]))
  // 探索の間の更新（c はまだ一度も送っていないので、間をあける必要がない）。
  let #(_, looked) = send(d, "c", paint_payload("#445566", "maleCrouch"))
  let assert [look] = payloads(looked, "look")
  decode.run(look, decode.at(["playerId"], decode.string))
  |> should.equal(Ok("c"))
  decode.run(look, decode.at(["pose"], decode.string))
  |> should.equal(Ok("maleCrouch"))
}

/// 入り直した人には、探索の間、いまの動く隠れ側を本人宛てで送る。
pub fn roaming_notice_is_resent_to_subscribers_test() {
  let #(d, _) = to_exploration(True)
  let resent = driver.subscribed(d, PlayerId("b"))
  let assert [_] = payloads(resent, "roaming")
}

// --- 従来の規則 ---------------------------------------------------------------

/// 従来の規則のルームでは、動く隠れ側の通知も、見た目の通知も、そのタイマーも、作らない。
pub fn classic_rooms_never_make_roaming_notices_test() {
  let #(d, effects) = to_exploration(False)
  let #(sx, sz) = b_spot()
  let #(d, moved) = send(d, "a", move_payload(sx +. 0.2, sz, 1.0))
  let #(d, hid) = send(d, "b", move_payload(sx +. 0.2, sz, 1.0))
  let #(_, looked) = send(d, "b", paint_payload("#112233", "idle"))
  let all =
    list.flatten([
      effects,
      moved,
      hid,
      looked,
      driver.subscribed(d, PlayerId("b")),
    ])
  roaming_timers(all) |> should.equal([])
  payloads(all, "roaming") |> should.equal([])
  payloads(all, "look") |> should.equal([])
}

// --- 増え鬼（ADR 0053） --------------------------------------------------------

fn spreading_spec(spreading: Bool) -> room_actor.RoomSpec {
  veryare.spec_with_rules(
    RoomId("v"),
    Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
    RandomLayout,
    Rules(roaming: False, spreading:),
    durations(),
    fn(_size) { 0 },
    fn() { 0 },
  )
}

/// 増え鬼の、a が鬼・b と c が隠れ側の探索の始まりまで。
fn spreading_exploration(spreading: Bool) -> Step {
  let assert Some(factory) = spreading_spec(spreading).driver
  let #(d, _) = factory([PlayerId("a"), PlayerId("b"), PlayerId("c")])
  let #(d, e1) = send(d, "a", move_payload(0.0, 0.0, 0.0))
  let #(d, e2) = driver.wake(d, phase_timer(e1))
  let layout = stage.generate(0)
  let assert [#(bx, bz), #(cx, cz)] =
    spread.spots(grid.of_layout(layout), layout.skeleton.spawn, 2, 7.0)
  let #(d, _) = send(d, "b", move_payload(bx, bz, 0.0))
  let #(d, _) = send(d, "c", move_payload(cx, cz, 0.0))
  let #(d, e3) = driver.wake(d, phase_timer(e2))
  let #(d, e4) = driver.wake(d, last_phase_timer(e3))
  #(d, e4)
}

fn shoot_payload(target: String) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("shoot")),
    #(dynamic.string("target"), dynamic.string(target)),
  ])
}

fn others_of(payload: Dynamic) -> option.Option(List(roaming.Hider)) {
  let assert Ok(others) = roaming.decode_others(payload)
  others
}

/// spreading は省略すると既定（従来）。1 は増え鬼。ほかの値は拒む。ルーム情報に spreading: true。
pub fn spreading_rules_are_parsed_test() {
  veryare.default_spreading |> should.equal(0)
  veryare.parse_rules(settings([#("spreading", dynamic.int(1))]))
  |> should.equal(Ok(Rules(roaming: False, spreading: True)))
  veryare.parse_rules(
    settings([#("spreading", dynamic.int(1)), #("roaming", dynamic.int(1))]),
  )
  |> should.equal(Ok(Rules(roaming: True, spreading: True)))
  veryare.parse_rules(settings([#("spreading", dynamic.int(2))]))
  |> should.equal(Error(Nil))
  let assert Some(info) = spreading_spec(True).member_info
  decode.run(info, decode.at(["spreading"], decode.bool))
  |> should.equal(Ok(True))
  let assert Some(classic) = spreading_spec(False).member_info
  decode.run(classic, decode.at(["spreading"], decode.bool))
  |> should.be_error
}

/// 撃たれた人間の隠れ側は鬼になり、その場で、others に載った鬼の通知が全員へ届く。
pub fn converted_oni_is_broadcast_at_once_test() {
  let #(d, effects) = spreading_exploration(True)
  // 探索の始まりの鬼の位置（玄関）から、b の場所は射程の内側（spread は 7 m 以内）。見通しが通るかは
  // 地図による（一直線に動けるので、通る）。
  let assert [_, ..] = payloads(effects, "phase")
  let #(_, shot) = send(d, "a", shoot_payload("b"))
  let assert [oni] = payloads(shot, "oni")
  let assert Some([converted]) = others_of(oni)
  converted.player_id |> should.equal("b")
  let assert [hiding] = payloads(shot, "hiding")
  decode.run(hiding, decode.at(["playerIds"], decode.list(decode.string)))
  |> should.equal(Ok(["c"]))
}

/// 鬼になった人が動いたら、タイマーで、まとめた鬼の通知を送る（変わったときだけ）。
pub fn converted_oni_moves_are_batched_test() {
  let #(d, _) = spreading_exploration(True)
  let #(d, _) = send(d, "a", shoot_payload("b"))
  let #(bx, bz) = b_spot()
  let #(d, moved) = send(d, "b", move_payload(bx +. 0.2, bz, 1.0))
  let assert [token] =
    list.filter_map(moved, fn(effect) {
      case effect {
        driver.WakeAfter(ms, token) if ms == veryare.roaming_interval_ms ->
          Ok(token)
        _ -> Error(Nil)
      }
    })
  let #(_, woke) = driver.wake(d, token)
  let assert [oni] = payloads(woke, "oni")
  let assert Some([converted]) = others_of(oni)
  converted.x |> should.equal(bx +. 0.2)
  converted.facing |> should.equal(Some(1.0))
}

/// 従来の規則では、撃たれた人は鬼にならず、鬼の通知に others は載らない。
pub fn classic_oni_notice_has_no_others_test() {
  let #(d, _) = spreading_exploration(False)
  let #(d, _) = send(d, "a", shoot_payload("b"))
  let #(sx, sz) = b_spot()
  let #(_, moved) = send(d, "a", move_payload(sx, sz, 0.5))
  let assert [oni] = payloads(moved, "oni")
  others_of(oni) |> should.equal(None)
}
