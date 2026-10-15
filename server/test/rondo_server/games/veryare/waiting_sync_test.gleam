//// 待機ルームのメンバーの通知の送り方（issue-59 / ADR 0044）。
////
//// driver を直接動かし、タイマー（WakeAfter）を手で起こして、送る間隔・変わったときだけ送ること・
//// フェーズで止まることを確かめる。後半は room_actor を通して、参加者でない接続に届かないこと、
//// 途中参加・再接続の人に本人宛てで届くことを確かめる。

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/members
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, Settings} as veryare
import rondo_server/protocol/message.{type ServerMessage, GameState, GameStateTo}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{type Message, Player, PlayerId, RoomId}

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

fn spec() {
  veryare.spec_with(
    RoomId("v"),
    Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
    durations(),
    fn(_size) { 0 },
  )
}

fn begin(ids: List(String)) -> Driver(room_actor.PlayerId) {
  let assert Some(factory) = spec().driver
  let #(started, _) = factory(list.map(ids, PlayerId))
  started
}

fn move_payload(x: Float, z: Float, facing: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
    #(dynamic.string("facing"), dynamic.float(facing)),
  ])
}

fn pose_payload(pose: String) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("waiting-pose")),
    #(dynamic.string("pose"), dynamic.string(pose)),
  ])
}

fn send(
  d: Driver(room_actor.PlayerId),
  id: String,
  payload: Dynamic,
) -> #(Driver(room_actor.PlayerId), List(Effect(room_actor.PlayerId))) {
  driver.event(d, PlayerId(id), payload)
}

/// メンバーの通知のタイマー（150 ms）の token。
fn member_timers(effects: List(Effect(room_actor.PlayerId))) -> List(Int) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(ms, token) if ms == veryare.members_interval_ms ->
        Ok(token)
      _ -> Error(Nil)
    }
  })
}

fn is_members(payload: Dynamic) -> Bool {
  decode.run(payload, decode.at(["type"], decode.string)) == Ok("members")
}

/// 全員宛てのメンバーの通知を、読んだ形で取り出す。
fn broadcasts(
  effects: List(Effect(room_actor.PlayerId)),
) -> List(List(members.Member)) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(payload) ->
        case is_members(payload) {
          True -> members.decode_notice(payload)
          False -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

fn only_timer(effects: List(Effect(room_actor.PlayerId))) -> Int {
  let assert [token] = member_timers(effects)
  token
}

// --- 送る間隔と、変わったときだけ ---------------------------------------------------

/// 動いたら 150 ms のタイマーを1つ張り、張っている間の動きでは重ねて張らない。起きたら、
/// 最後の様子を1通で全員へ送る。
pub fn move_schedules_one_timer_and_sends_latest_test() {
  veryare.members_interval_ms |> should.equal(150)
  let d = begin(["a", "b"])
  let #(d, first) = send(d, "a", move_payload(1.0, 0.5, 0.0))
  let token = only_timer(first)
  let #(d, second) = send(d, "a", move_payload(1.234, 0.5, 0.0))
  member_timers(second) |> should.equal([])
  // 起きるまでは送らない。
  broadcasts(list.append(first, second)) |> should.equal([])

  let #(_, woke) = driver.wake(d, token)
  let assert [[a, b]] = broadcasts(woke)
  a |> should.equal(members.Member("a", 1.23, 0.5, Some(0.0), None))
  b.player_id |> should.equal("b")
  // 送った後は、変わるまで張らない。
  member_timers(woke) |> should.equal([])
}

/// 動いていない（同じ位置・同じ向きの報告）ときは、タイマーも通知も出ない。
pub fn no_notice_when_nothing_changes_test() {
  let d = begin(["a", "b"])
  let #(d, first) = send(d, "a", move_payload(1.0, 0.5, 1.0))
  let #(d, _) = driver.wake(d, only_timer(first))
  let #(d, same) = send(d, "a", move_payload(1.0, 0.5, 1.0))
  member_timers(same) |> should.equal([])
  // 向きの細かい揺れ（0.05 rad 未満）と、丸めで消える位置の揺れでも出ない。
  let #(_, jitter) = send(d, "a", move_payload(1.001, 0.502, 1.012))
  member_timers(jitter) |> should.equal([])
  broadcasts(list.append(same, jitter)) |> should.equal([])
}

/// 起きたときに、最後に送った内容と同じなら送らない（行って戻ってきた場合）。
pub fn same_as_last_sent_is_not_sent_test() {
  let d = begin(["a", "b"])
  let #(d, first) = send(d, "a", move_payload(1.0, 0.5, 0.0))
  let #(d, _) = driver.wake(d, only_timer(first))
  let #(d, away) = send(d, "a", move_payload(2.0, 0.5, 0.0))
  let token = only_timer(away)
  let #(d, _) = send(d, "a", move_payload(1.0, 0.5, 0.0))
  let #(_, woke) = driver.wake(d, token)
  broadcasts(woke) |> should.equal([])
  member_timers(woke) |> should.equal([])
}

// --- 待機ポーズ -------------------------------------------------------------------

/// 待機ポーズの変更は、メンバーの通知で全員に届く。一覧に無いポーズは無視され、何も出ない。
pub fn waiting_pose_reaches_everyone_test() {
  let d = begin(["a", "b"])
  let #(d, ignored) = send(d, "b", pose_payload("standing"))
  ignored |> should.equal([])
  let #(d, changed) = send(d, "b", pose_payload("femaleDance"))
  let #(_, woke) = driver.wake(d, only_timer(changed))
  let assert [[_, b]] = broadcasts(woke)
  b.pose |> should.equal(Some("femaleDance"))
}

/// 続けて変えても、0.3 秒たつまでは最初の変更だけが効く。
pub fn waiting_pose_burst_keeps_first_test() {
  let d = begin(["a", "b"])
  let #(d, changed) = send(d, "b", pose_payload("femaleDance"))
  let #(d, _) = send(d, "b", pose_payload("maleSitting1"))
  let #(_, woke) = driver.wake(d, only_timer(changed))
  let assert [[_, b]] = broadcasts(woke)
  b.pose |> should.equal(Some("femaleDance"))
}

// --- フェーズで止まる ---------------------------------------------------------------

/// タイマーを張った後に step が進んだら（カウントの開始）、その時点では送らず、張り直して次に送る。
pub fn step_change_skips_then_reschedules_test() {
  let d = begin(["a", "b"])
  let #(d, moved) = send(d, "b", move_payload(1.0, 1.0, 0.0))
  let old = only_timer(moved)
  // a がエリアに触れて、カウントが始まる（step が進む）。張ってあるので重ねて張らない。
  let #(d, touched) = send(d, "a", move_payload(0.0, 0.0, 0.0))
  member_timers(touched) |> should.equal([])
  let #(d, stale) = driver.wake(d, old)
  broadcasts(stale) |> should.equal([])
  let fresh = only_timer(stale)
  { fresh != old } |> should.be_true
  let #(_, woke) = driver.wake(d, fresh)
  let assert [[a, b]] = broadcasts(woke)
  #(a.x, a.z, b.x, b.z) |> should.equal(#(0.0, 0.0, 1.0, 1.0))
}

/// ステージに移ったら（鬼選出が済んだら）、待機の通知は出ない。古いタイマーが起きても送らない。
pub fn stops_after_moving_to_stage_test() {
  let d = begin(["a", "b"])
  let #(d, moved) = send(d, "b", move_payload(1.0, 1.0, 0.0))
  let pending = only_timer(moved)
  let #(d, touched) = send(d, "a", move_payload(0.0, 0.0, 0.0))
  // カウントのタイマー（10 秒）を起こして、鬼選出を終える。
  let assert [count] =
    list.filter_map(touched, fn(effect) {
      case effect {
        driver.WakeAfter(10_000, token) -> Ok(token)
        _ -> Error(Nil)
      }
    })
  let #(d, selected) = driver.wake(d, count)
  broadcasts(selected) |> should.equal([])
  let #(d, old) = driver.wake(d, pending)
  broadcasts(old) |> should.equal([])
  member_timers(old) |> should.equal([])
  // ステージでの動き・待機ポーズでは張らない。ステージの位置は、待機の通知に載らない。
  let #(d, staged) = send(d, "b", move_payload(4.5, 4.5, 0.0))
  let #(_, posed) = send(d, "b", pose_payload("idle"))
  member_timers(list.append(staged, posed)) |> should.equal([])
  broadcasts(list.append(staged, posed)) |> should.equal([])
}

// --- 通知の中身 ---------------------------------------------------------------------

/// 通知は type と members だけで、各メンバーは playerId・x・z・facing・pose だけ（名前・ステージの
/// 位置は載せない）。
pub fn notice_has_only_member_fields_test() {
  let d = begin(["a", "b"])
  let #(d, moved) = send(d, "a", move_payload(1.0, 0.5, 0.0))
  let #(_, woke) = driver.wake(d, only_timer(moved))
  let assert [driver.Broadcast(payload)] =
    list.filter(woke, fn(effect) {
      case effect {
        driver.Broadcast(p) -> is_members(p)
        _ -> False
      }
    })
  let keys = fn(value: Dynamic) {
    let assert Ok(entries) =
      decode.run(value, decode.dict(decode.string, decode.dynamic))
    entries |> dict.keys |> list.sort(string.compare)
  }
  keys(payload) |> should.equal(["members", "type"])
  let assert Ok([first, ..]) =
    decode.run(payload, decode.at(["members"], decode.list(decode.dynamic)))
  keys(first) |> should.equal(["facing", "playerId", "pose", "x", "z"])
}

// --- ルームを通した配信 ---------------------------------------------------------------

fn open_room(ids: List(String)) -> Subject(Message) {
  let assert Ok(started) = room_actor.start(spec())
  list.each(ids, fn(id) {
    let assert Ok(Nil) = room_actor.join(started.data, Player(PlayerId(id), id))
  })
  // veryare は作成と同時に始まる（実接続では session が始める）。
  let assert Ok(Nil) = room_actor.start_game(started.data)
  started.data
}

fn subscribe(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  room_actor.subscribe(room, PlayerId(id), outbox)
  outbox
}

/// 届いたメンバーの通知（全員宛て・本人宛て）。ほかの電文は読み飛ばし、時間内に無ければ []。
fn received_members(
  outbox: Subject(ServerMessage),
) -> List(List(members.Member)) {
  case process.receive(outbox, 600) {
    Ok(GameState(payload:, ..)) | Ok(GameStateTo(payload:, ..)) ->
      case is_members(payload) {
        True -> {
          let assert Ok(list) = members.decode_notice(payload)
          [list, ..received_members(outbox)]
        }
        False -> received_members(outbox)
      }
    Ok(_) -> received_members(outbox)
    Error(Nil) -> []
  }
}

/// 参加者には届き、参加者でない接続には届かない。
pub fn non_participants_receive_nothing_test() {
  let room = open_room(["a", "b"])
  let a = subscribe(room, "a")
  let stranger = subscribe(room, "x")
  room_actor.game_event(room, PlayerId("a"), move_payload(1.0, 0.5, 0.0))
  let got = received_members(a)
  { got != [] } |> should.be_true
  let assert Ok(latest) = list.last(got)
  let assert Ok(me) = list.find(latest, fn(m) { m.player_id == "a" })
  #(me.x, me.z) |> should.equal(#(1.0, 0.5))
  received_members(stranger) |> should.equal([])
}

/// 途中参加の人には、入室を処理した後に、本人宛てで今の様子（本人を含む）が届く（購読者に届ける状態 /
/// join_snapshot_test）。続けて、本人を含む全員宛ての通知が届く。
pub fn late_joiner_receives_current_members_test() {
  let room = open_room(["a", "b"])
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId("c"), "c"), outbox)
  let assert [first, ..rest] = received_members(outbox)
  list.map(first, fn(m) { m.player_id }) |> should.equal(["a", "b", "c"])
  let assert Ok(latest) = list.last(rest)
  list.map(latest, fn(m) { m.player_id }) |> should.equal(["a", "b", "c"])
}

/// 再接続で戻った人（resync）には、本人宛てで今の様子が届く。
pub fn resync_receives_current_members_test() {
  let room = open_room(["a", "b"])
  let a = subscribe(room, "a")
  // 登録の直後の分（入室後の案内）を読み切る。
  let _ = received_members(a)
  room_actor.resync(room, PlayerId("a"))
  let assert [first, ..] = received_members(a)
  list.map(first, fn(m) { m.player_id }) |> should.equal(["a", "b"])
}
