//// 平屋のルーム（issue-44）: ステージの選び方の受け口（ルーム作成の設定 stage）と、平屋のルームで
//// 届くステージの通知・襖の通知。

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/games/veryare/game
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{
  HiderCpus, Hiraya, NoCpu, RandomLayout, Settings,
} as veryare
import rondo_server/games/veryare/stage_notice
import rondo_server/protocol/message.{type ServerMessage, GameState}
import rondo_server/room/room_actor.{type Message, Player, PlayerId, RoomId}

// --- 補助 ---------------------------------------------------------------

fn raw(entries: List(#(String, Dynamic))) -> option.Option(Dynamic) {
  entries
  |> list.map(fn(entry) { #(dynamic.string(entry.0), entry.1) })
  |> dynamic.properties
  |> Some
}

fn durations() -> game.Durations {
  game.Durations(
    oni_selection_ms: 30,
    preparation_ms: 300,
    painting_ms: 30,
    exploration_ms: 300,
    reveal_ms: 30,
    reload_ms: 3000,
  )
}

/// 平屋のルームを開き、a と b を入れて、それぞれの受け口を返す。
fn open_hiraya() -> #(Subject(Message), Subject(ServerMessage)) {
  let spec =
    veryare.spec_with_stage(
      RoomId("v"),
      Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
      Hiraya,
      durations(),
      fn(_size) { 0 },
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("a"), "a"))
  let assert Ok(Nil) = room_actor.join(room, Player(PlayerId("b"), "b"))
  let a = process.new_subject()
  room_actor.subscribe(room, PlayerId("a"), a)
  #(room, a)
}

/// 次に届くステージの通知。ほかの電文は読み飛ばす。
fn next_stage(outbox: Subject(ServerMessage)) -> Dynamic {
  case process.receive(outbox, 1000) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) ->
      case stage_notice.decode(payload) {
        Ok(_) -> payload
        Error(Nil) -> next_stage(outbox)
      }
    Ok(_) -> next_stage(outbox)
    Error(Nil) -> panic as "ステージの通知が届かない"
  }
}

/// 次に届く襖の通知の、開いている襖の数。
fn next_doors(outbox: Subject(ServerMessage)) -> set.Set(grid.Edge) {
  case process.receive(outbox, 1000) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) ->
      case stage_notice.decode_doors(payload) {
        Ok(open) -> open
        Error(Nil) -> next_doors(outbox)
      }
    Ok(_) -> next_doors(outbox)
    Error(Nil) -> panic as "襖の通知が届かない"
  }
}

/// 指定のフェーズの通知が届くまで読む。
fn until_phase(outbox: Subject(ServerMessage), name: String) -> Nil {
  case process.receive(outbox, 1000) {
    Ok(GameState(payload:, ..)) ->
      case
        decode.run(payload, {
          use kind <- decode.field("type", decode.string)
          use phase <- decode.field("phase", decode.string)
          decode.success(#(kind, phase))
        })
      {
        Ok(#("phase", phase)) if phase == name -> Nil
        _ -> until_phase(outbox, name)
      }
    Ok(_) -> until_phase(outbox, name)
    Error(Nil) -> panic as { "フェーズが届かない: " <> name }
  }
}

fn move(x: Float, z: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
  ])
}

// --- ステージの選び方の受け口 -------------------------------------------

/// stage は 0 = ランダム間取り、1 = 平屋。省略時はランダム間取り。
pub fn stage_choice_is_read_from_the_settings_test() {
  let normal = Settings(40, NoCpu, oni_cpu.Normal)
  veryare.parse_room(None) |> should.equal(Ok(#(normal, RandomLayout)))
  veryare.parse_room(raw([]))
  |> should.equal(Ok(#(normal, RandomLayout)))
  veryare.parse_room(raw([#("stage", dynamic.int(0))]))
  |> should.equal(Ok(#(normal, RandomLayout)))
  veryare.parse_room(raw([#("stage", dynamic.int(1))]))
  |> should.equal(Ok(#(normal, Hiraya)))
  // ほかの設定と一緒に読める。
  veryare.parse_room(
    raw([#("stage", dynamic.int(0)), #("cpu", dynamic.int(2))]),
  )
  |> should.equal(
    Ok(#(Settings(40, HiderCpus(2), oni_cpu.Normal), RandomLayout)),
  )
}

/// 知らない値・形の違う値は拒む。平屋と CPU の組み合わせは、issue-45 まで拒む。
pub fn unknown_stage_and_hiraya_with_cpus_are_rejected_test() {
  veryare.parse_room(raw([#("stage", dynamic.int(2))])) |> should.be_error
  veryare.parse_room(raw([#("stage", dynamic.int(-1))])) |> should.be_error
  veryare.parse_room(raw([#("stage", dynamic.string("hiraya"))]))
  |> should.be_error
  veryare.parse_room(
    raw([#("stage", dynamic.int(1)), #("cpu", dynamic.int(1))]),
  )
  |> should.be_error
  veryare.parse_room(
    raw([#("stage", dynamic.int(1)), #("cpu", dynamic.int(4))]),
  )
  |> should.be_error
  // ほかの設定の誤りは、これまでどおり拒む。
  veryare.parse_room(raw([#("explorationSeconds", dynamic.int(41))]))
  |> should.be_error
}

/// ルーム作成（catalog）は、平屋の設定を受け付け、誤りは InvalidSettings にする。
pub fn catalog_accepts_hiraya_and_rejects_hiraya_with_cpus_test() {
  catalog.spec_for(
    "veryare",
    RoomId("v"),
    raw([#("stage", dynamic.int(1))]),
    timing.Normal,
  )
  |> should.be_ok
  catalog.spec_for(
    "veryare",
    RoomId("v"),
    raw([#("stage", dynamic.int(1)), #("cpu", dynamic.int(2))]),
    timing.Normal,
  )
  |> should.equal(Error(catalog.InvalidSettings))
}

// --- 平屋のルーム -------------------------------------------------------

/// 平屋のルームでは、ステージの通知に平屋のデータ（0.3 m の格子、戸の一覧、玄関の
/// (4.7, 11.3)）が載る。途中参加・再接続の人にも、本人宛てで同じ通知が届く。
pub fn hiraya_room_sends_the_hiraya_stage_notice_test() {
  let #(room, a) = open_hiraya()
  let assert Ok(Nil) = room_actor.start_game(room)
  let assert Ok(decoded) = stage_notice.decode(next_stage(a))
  let expected = hiraya.grid()
  decoded.grid.cell_size |> should.equal(0.3)
  decoded.grid.origin |> should.equal(#(-6.225, -0.275))
  decoded.grid.width |> should.equal(41)
  decoded.grid.depth |> should.equal(45)
  decoded.grid.regions |> should.equal(expected.regions)
  decoded.grid.doors |> should.equal(expected.doors)
  dict.size(decoded.grid.doors) |> should.equal(181)
  decoded.spawn |> should.equal(#(4.7, 11.3))
  decoded.rooms |> should.equal(dict.from_list(hiraya.rooms))
  // 入り直した b にも、平屋の通知が届く。
  let b = process.new_subject()
  room_actor.subscribe(room, PlayerId("b"), b)
  let assert Ok(again) = stage_notice.decode(next_stage(b))
  again.spawn |> should.equal(#(4.7, 11.3))
  again.grid.regions |> should.equal(expected.regions)
}

/// 平屋のルームで、襖の通知は、開始と準備移動で襖10組（108 辺）が全部開き、探索の開始で
/// 全部閉じ、答え合わせの開始で全部開く。
pub fn hiraya_room_door_notices_follow_the_phases_test() {
  let all = grid.fusuma(hiraya.grid())
  let #(room, a) = open_hiraya()
  let assert Ok(Nil) = room_actor.start_game(room)
  next_doors(a) |> should.equal(all)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  until_phase(a, "exploration")
  next_doors(a) |> should.equal(set.new())
  until_phase(a, "reveal")
  next_doors(a) |> should.equal(all)
}
