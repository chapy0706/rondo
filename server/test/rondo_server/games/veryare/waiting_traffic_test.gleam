//// 待機ルームの同期の通信量（issue-59 / ADR 0044）。
////
//// 1 ルーム 5 人が、クライアントの送る間隔（50 ms）で動き続けたときの、メンバーの通知の数と
//// 1 通の大きさを、driver をテストの中の時計で動かして数える（サーバーを起動しない）。タイマー
//// （WakeAfter）は、張った時刻 + 間隔に起こす。目安（1 ルームで毎秒 50 通以下）に収まることを確かめる。

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, Settings} as veryare
import rondo_server/protocol/message.{GameState}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{type PlayerId, PlayerId, RoomId}

/// 本番に近い識別子（暗号用の乱数 16 バイトの 16 進）。
const ids = [
  "0123456789abcdef0123456789abcde0", "0123456789abcdef0123456789abcde1",
  "0123456789abcdef0123456789abcde2", "0123456789abcdef0123456789abcde3",
  "0123456789abcdef0123456789abcde4",
]

/// 測る長さ（ミリ秒）と、クライアントの送る間隔。
const span_ms = 3000

const send_interval_ms = 50

fn begin() -> Driver(PlayerId) {
  let durations =
    game.Durations(
      oni_selection_ms: 10_000,
      preparation_ms: 20_000,
      painting_ms: 20_000,
      exploration_ms: 40_000,
      reveal_ms: 20_000,
      reload_ms: 3000,
    )
  let spec =
    veryare.spec_with(
      RoomId("v"),
      Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
      durations,
      fn(_size) { 0 },
    )
  let assert Some(factory) = spec.driver
  let #(started, _) = factory(list.map(ids, PlayerId))
  started
}

/// 5 人が、鬼希望エリアに入らないよう、半径 2.5 m の輪の上を回り続ける位置（向きも変わる）。
fn move_at(index: Int, time: Int) -> Dynamic {
  let angle =
    int.to_float(index) *. 1.2566 +. int.to_float(time) /. 1000.0 *. 1.5
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(2.5 *. cos(angle))),
    #(dynamic.string("z"), dynamic.float(2.5 *. sin(angle))),
    #(dynamic.string("facing"), dynamic.float(angle +. 1.5708)),
  ])
}

fn pose_at(index: Int) -> Dynamic {
  let poses = [
    "femaleStanding1", "maleSitting4", "femaleDynamic3", "maleLaying2",
    "femaleDance",
  ]
  let assert Ok(pose) = list.drop(poses, index) |> list.first
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("waiting-pose")),
    #(dynamic.string("pose"), dynamic.string(pose)),
  ])
}

@external(erlang, "math", "cos")
fn cos(x: Float) -> Float

@external(erlang, "math", "sin")
fn sin(x: Float) -> Float

type Run {
  Run(
    driver: Driver(PlayerId),
    /// 張られたタイマー（起こす時刻、token）。
    timers: List(#(Int, Int)),
    /// 送られたメンバーの通知（1 通の JSON）。
    sent: List(String),
  )
}

fn apply(run: Run, time: Int, result) -> Run {
  let #(next, effects): #(Driver(PlayerId), List(Effect(PlayerId))) = result
  let timers =
    list.filter_map(effects, fn(effect) {
      case effect {
        driver.WakeAfter(ms, token) if ms == veryare.members_interval_ms ->
          Ok(#(time + ms, token))
        _ -> Error(Nil)
      }
    })
  let sent =
    list.filter_map(effects, fn(effect) {
      case effect {
        driver.Broadcast(payload) ->
          case
            decode.run(payload, decode.at(["type"], decode.string))
            == Ok("members")
          {
            True ->
              Ok(
                message.encode_server(GameState(
                  game_type: "veryare",
                  room_id: "room-0123456789abcdef",
                  payload:,
                )),
              )
            False -> Error(Nil)
          }
        _ -> Error(Nil)
      }
    })
  Run(
    driver: next,
    timers: list.append(run.timers, timers),
    sent: list.append(run.sent, sent),
  )
}

/// time までに起きるタイマーを起こす。
fn wake_due(run: Run, time: Int) -> Run {
  let #(due, later) = list.partition(run.timers, fn(t) { t.0 <= time })
  list.fold(due, Run(..run, timers: later), fn(acc, timer) {
    apply(acc, timer.0, driver.wake(acc.driver, timer.1))
  })
}

/// 送る間隔ごとに、起きるタイマーを起こしてから、全員が動く。
fn ticks(run: Run, tick: Int) -> Run {
  let time = tick * send_interval_ms
  case time >= span_ms {
    True -> run
    False -> {
      let woke = wake_due(run, time)
      let moved =
        list.index_fold(ids, woke, fn(acc, id, index) {
          apply(
            acc,
            time,
            driver.event(acc.driver, PlayerId(id), move_at(index, time)),
          )
        })
      ticks(moved, tick + 1)
    }
  }
}

fn simulate() -> Run {
  let start = Run(driver: begin(), timers: [], sent: [])
  // はじめに全員が待機ポーズを選ぶ（ポーズも載せた、いちばん大きい形で測る）。
  let posed =
    list.index_fold(ids, start, fn(acc, id, index) {
      apply(acc, 0, driver.event(acc.driver, PlayerId(id), pose_at(index)))
    })
  ticks(posed, 0)
  |> wake_due(span_ms)
}

/// 5 人が動き続けても、メンバーの通知は 1 秒に 150 ms 間隔ぶん（約 6.7 回）以下。5 人へ送るので、
/// 1 ルームで毎秒の通数は 50 通以下（約 33 通）。
pub fn five_moving_players_stay_within_budget_test() {
  let run = simulate()
  let notices = list.length(run.sent)
  let per_second = int.to_float(notices) /. { int.to_float(span_ms) /. 1000.0 }
  { per_second <=. 1000.0 /. int.to_float(veryare.members_interval_ms) +. 0.5 }
  |> should.be_true
  { per_second *. 5.0 <=. 50.0 } |> should.be_true
  // 動き続けているので、送らない間が空きすぎない（毎秒 5 回以上）。
  { per_second >=. 5.0 } |> should.be_true
}

/// 1 通の大きさ（外側の電文を含む JSON のバイト数）は、5 人・全員がポーズありで 1 KB 未満。
pub fn notice_size_is_small_test() {
  let run = simulate()
  let sizes = list.map(run.sent, string.byte_size)
  let assert Ok(largest) = list.reduce(sizes, int.max)
  { largest < 1024 } |> should.be_true
  { largest > 0 } |> should.be_true
}
