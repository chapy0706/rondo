//// veryare の観戦ルーム（issue-67 段階 2 の ②）。設定の読み取りと旗、試合の始まり方と、次の試合。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleeunit/should
import rondo_server/games/catalog.{InvalidSettings}
import rondo_server/games/timing
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{RandomLayout, SpectateSettings, WideOnly}
import rondo_server/room/driver.{type Effect}
import rondo_server/room/room_actor.{type PlayerId, RoomId}

fn settings(fields: List(#(String, Dynamic))) -> option.Option(Dynamic) {
  Some(
    dynamic.properties(
      list.map(fields, fn(field) { #(dynamic.string(field.0), field.1) }),
    ),
  )
}

fn spectate(more: List(#(String, Dynamic))) {
  settings([#("spectate", dynamic.int(1)), ..more])
}

// --- 旗と、設定の読み取り ----------------------------------------------------------

/// 旗は、既定で下りている（本番に出さない）。開発用の環境変数は、1 のときだけ。
pub fn spectate_flag_is_down_test() {
  room.spectate_ready |> should.be_false
  room.spectate_dev_env_name |> should.equal("RONDO_SPECTATE_DEV")
  room.spectate_dev(Ok("1")) |> should.be_true
  room.spectate_dev(Ok(" 1 ")) |> should.be_true
  room.spectate_dev(Ok("0")) |> should.be_false
  room.spectate_dev(Ok("true")) |> should.be_false
  room.spectate_dev(Error(Nil)) |> should.be_false
}

/// 旗が下りていて、環境変数も無ければ、spectate: 1 の作成は invalid-settings で断る。
pub fn spectate_room_is_refused_without_the_flag_test() {
  room.parse_spectate(spectate([]), False, False) |> should.equal(Error(Nil))
  // テストの環境では RONDO_SPECTATE_DEV を付けないので、作成の入口でも断られる。
  catalog.room_for("veryare", RoomId("x"), spectate([]), timing.Normal)
  |> should.equal(Error(InvalidSettings))
}

/// spectate が無い・0 なら、対戦のルーム（これまでどおり parse_room で読む）。
pub fn without_spectate_it_is_a_match_room_test() {
  room.parse_spectate(None, True, False) |> should.equal(Ok(None))
  room.parse_spectate(settings([]), True, False) |> should.equal(Ok(None))
  room.parse_spectate(settings([#("spectate", dynamic.int(0))]), True, False)
  |> should.equal(Ok(None))
}

/// 受け付けるときは、隠れ CPU の数（1〜4。既定 3）・探索時間・ステージ（ランダム間取り）を読む。
pub fn spectate_settings_are_read_when_allowed_test() {
  room.parse_spectate(spectate([]), True, False)
  |> should.equal(Ok(Some(SpectateSettings(3, 40, RandomLayout))))
  room.parse_spectate(
    spectate([
      #("hiderCpus", dynamic.int(4)),
      #("explorationSeconds", dynamic.int(80)),
    ]),
    True,
    False,
  )
  |> should.equal(Ok(Some(SpectateSettings(4, 80, RandomLayout))))
  // 範囲の外の値・知らない spectate の値は断る。
  list.each([0, 5], fn(n) {
    room.parse_spectate(spectate([#("hiderCpus", dynamic.int(n))]), True, False)
    |> should.equal(Error(Nil))
  })
  room.parse_spectate(
    spectate([#("explorationSeconds", dynamic.int(50))]),
    True,
    False,
  )
  |> should.equal(Error(Nil))
  room.parse_spectate(settings([#("spectate", dynamic.int(2))]), True, False)
  |> should.equal(Error(Nil))
}

/// 隠れ CPU の数は hiderCpus で読む。対戦のルームの cpu（4 = 鬼 CPU）とは意味が違うので、観戦ルーム
/// では cpu を読まない（あっても既定の 3 のまま）。対戦のルームの cpu の読み方は、これまでどおり。
pub fn spectate_reads_hider_cpus_not_cpu_test() {
  room.parse_spectate(spectate([#("cpu", dynamic.int(1))]), True, False)
  |> should.equal(Ok(Some(SpectateSettings(3, 40, RandomLayout))))
  room.parse_spectate(
    spectate([#("cpu", dynamic.int(4)), #("hiderCpus", dynamic.int(2))]),
    True,
    False,
  )
  |> should.equal(Ok(Some(SpectateSettings(2, 40, RandomLayout))))
  room.parse_settings(settings([#("cpu", dynamic.int(4))]))
  |> should.equal(Ok(room.Settings(40, room.OniCpu, oni_cpu.Normal)))
}

/// ステージは、ランダム間取りだけ。広い屋敷だけ（3）は、RONDO_WIDE_DEV=1 のときだけ。平屋（1）と
/// おまかせ（2）は、観戦ルームでは選べない。
pub fn spectate_stage_choices_test() {
  room.parse_spectate(spectate([#("stage", dynamic.int(3))]), True, True)
  |> should.equal(Ok(Some(SpectateSettings(3, 40, WideOnly))))
  room.parse_spectate(spectate([#("stage", dynamic.int(3))]), True, False)
  |> should.equal(Error(Nil))
  list.each([1, 2, 99], fn(stage) {
    room.parse_spectate(spectate([#("stage", dynamic.int(stage))]), True, True)
    |> should.equal(Error(Nil))
  })
}

/// 観戦ルームの時間と上限（本番の値と、テスト用の短縮）。
pub fn spectate_config_test() {
  room.spectate_config(timing.Normal)
  |> should.equal(room_actor.SpectateConfig(
    max_spectators: 20,
    next_game_ms: 10_000,
    idle_close_ms: 60_000,
  ))
  room.spectate_config(timing.Faster(20))
  |> should.equal(room_actor.SpectateConfig(
    max_spectators: 20,
    next_game_ms: 500,
    idle_close_ms: 3000,
  ))
}

// --- 試合の始まり方と、次の試合 ------------------------------------------------------

fn spectate_spec() {
  room.spectate_spec_with(
    RoomId("s"),
    SpectateSettings(3, 40, RandomLayout),
    game.durations(exploration_ms: 40_000),
    fn(size) { 5 % size },
    fn() { 0 },
  )
}

/// 全体配信のフェーズの通知の phase と、張るタイマーの token。
fn phases(effects: List(Effect(PlayerId))) -> List(String) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(payload) ->
        decode.run(payload, {
          use kind <- decode.field("type", decode.string)
          use phase <- decode.field("phase", decode.string)
          case kind {
            "phase" -> decode.success(phase)
            _ -> decode.failure("", "phase")
          }
        })
        |> result.replace_error(Nil)
      _ -> Error(Nil)
    }
  })
}

fn tokens(effects: List(Effect(PlayerId))) -> List(Int) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(token:, ..) -> Ok(token)
      _ -> Error(Nil)
    }
  })
}

/// 参加者は、鬼 CPU 1 体と隠れ CPU 3 体（観戦ルームの既定）だけ。入室後の案内に spectate: true。
pub fn spectate_room_has_only_cpus_test() {
  let spec = spectate_spec()
  list.map(spec.bots, fn(p) { p.name })
  |> should.equal(["CPU 1", "CPU 2", "CPU 3", "CPU 4"])
  let assert Some(info) = spec.member_info
  decode.run(info, decode.at(["spectate"], decode.bool))
  |> should.equal(Ok(True))
}

/// 作ると、鬼選出を飛ばして、準備移動から始まる。
pub fn spectate_game_starts_at_preparation_test() {
  let spec = spectate_spec()
  let assert Some(start) = spec.driver
  let #(_driver, effects) = start(list.map(spec.bots, fn(p) { p.id }))
  phases(effects) |> should.equal(["preparation"])
}

/// 次の試合は、作り直した箱で、また準備移動から始まる。タイマーの token（step）は、前の試合の続きの
/// 番号なので、前の試合のタイマーとは重ならない。
pub fn next_game_restarts_with_new_steps_test() {
  let spec = spectate_spec()
  let assert Some(start) = spec.driver
  let #(first, first_effects) = start(list.map(spec.bots, fn(p) { p.id }))
  let assert Ok(#(_second, second_effects)) = driver.restart(first)
  phases(second_effects) |> should.equal(["preparation"])
  let old = tokens(first_effects)
  let new = tokens(second_effects)
  list.each(new, fn(token) { list.contains(old, token) |> should.be_false })
}

/// 対戦のルームの箱は、次の試合を作れない（これまでどおり、結果のあとは終わったまま）。
pub fn match_room_cannot_restart_test() {
  let spec =
    room.spec(RoomId("m"), room.Settings(40, room.NoCpu, oni_cpu.Normal))
  let assert Some(start) = spec.driver
  let #(d, _) = start([room_actor.PlayerId("a"), room_actor.PlayerId("b")])
  driver.restart(d) |> should.equal(Error(Nil))
}
