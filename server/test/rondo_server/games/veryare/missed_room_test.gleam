//// 見逃しポイントといいねを、ルームの差し込み口（driver）を通して確かめる（issue-32 / ADR 0036）。
//// タイマー（WakeAfter）は手で起こす。
////
//// - 探索の開始に、0.5 秒ごとの見逃しポイントのタイマーを張り、起きるたびに張り直す。試合中は
////   ポイントを誰にも送らない（結果の行にだけ載せる）
//// - 人間の鬼の視界の報告（sight）で、視界内の加算に変わる
//// - 答え合わせの間のいいね（like）で、いいねの数の通知を全員へ送る。2回目・自分へのいいねは送らない
//// - 結果の行の隠れ側に、見逃しといいねが載る

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{Some}
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/missed_events
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{NoCpu, Settings} as veryare
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage
import rondo_server/room/driver.{type Driver, type Effect, type Standing}
import rondo_server/room/room_actor.{type PlayerId, PlayerId, RoomId}

const oni_selection_ms = 1000

const preparation_ms = 2000

const painting_ms = 3000

const exploration_ms = 40_000

const reveal_ms = 20_000

type Run =
  #(Driver(PlayerId), List(Effect(PlayerId)))

fn begin() -> Driver(PlayerId) {
  let durations =
    game.Durations(
      oni_selection_ms:,
      preparation_ms:,
      painting_ms:,
      exploration_ms:,
      reveal_ms:,
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
  let #(started, _) = factory([PlayerId("a"), PlayerId("b"), PlayerId("c")])
  started
}

fn payload(fields: List(#(String, Dynamic))) -> Dynamic {
  fields
  |> list.map(fn(f) { #(dynamic.string(f.0), f.1) })
  |> dynamic.properties
}

fn move(x: Float, z: Float) -> Dynamic {
  payload([
    #("type", dynamic.string("move")),
    #("x", dynamic.float(x)),
    #("z", dynamic.float(z)),
  ])
}

fn sight(ids: List(String)) -> Dynamic {
  payload([
    #("type", dynamic.string("sight")),
    #("playerIds", dynamic.list(list.map(ids, dynamic.string))),
  ])
}

fn like(target: String) -> Dynamic {
  payload([
    #("type", dynamic.string("like")),
    #("target", dynamic.string(target)),
  ])
}

fn send(d: Driver(PlayerId), id: String, p: Dynamic) -> Run {
  driver.event(d, PlayerId(id), p)
}

fn timer(effects: List(Effect(PlayerId)), ms: Int) -> Int {
  let assert [token] =
    list.filter_map(effects, fn(effect) {
      case effect {
        driver.WakeAfter(wait, token) if wait == ms -> Ok(token)
        _ -> Error(Nil)
      }
    })
  token
}

fn timers(effects: List(Effect(PlayerId)), ms: Int) -> List(Int) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.WakeAfter(wait, token) if wait == ms -> Ok(token)
      _ -> Error(Nil)
    }
  })
}

fn broadcasts(effects: List(Effect(PlayerId)), kind: String) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Broadcast(p) ->
        case decode.run(p, decode.at(["type"], decode.string)) {
          Ok(k) if k == kind -> Ok(p)
          _ -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

/// 部屋のステージ（乱数を 0 に固定しているので stage.generate(0)）で、玄関から一直線に着ける別々の場所。
fn spots(count: Int) -> List(#(Float, Float)) {
  let layout = stage.generate(0)
  spread.spots(grid.of_layout(layout), layout.skeleton.spawn, count, 7.0)
}

/// a が鬼、b・c が隠れ側の探索の開始まで進める。戻り値は、探索の開始の指示と、見逃しポイントの
/// タイマーの token。
fn to_exploration() -> #(Driver(PlayerId), List(Effect(PlayerId)), Int) {
  let d = begin()
  let #(d, touched) = send(d, "a", move(0.0, 0.0))
  let #(d, selected) = driver.wake(d, timer(touched, oni_selection_ms))
  let assert [#(bx, bz), #(cx, cz)] = spots(2)
  let #(d, _) = send(d, "b", move(bx, bz))
  let #(d, _) = send(d, "c", move(cx, cz))
  let #(d, painting) = driver.wake(d, timer(selected, preparation_ms))
  let #(d, exploring) = driver.wake(d, timer(painting, painting_ms))
  #(d, exploring, timer(exploring, game.missed_tick_ms))
}

/// 見逃しポイントのタイマーを n 回起こす（起きるたびに張り直されることも確かめる）。
fn tick(d: Driver(PlayerId), token: Int, n: Int) -> Driver(PlayerId) {
  case n {
    0 -> d
    _ -> {
      let #(d, woke) = driver.wake(d, token)
      timers(woke, game.missed_tick_ms) |> should.equal([token])
      // 試合中は、ポイントを誰にも送らない。
      list.filter(woke, fn(effect) {
        case effect {
          driver.Broadcast(_) | driver.Deliver(..) -> True
          _ -> False
        }
      })
      |> should.equal([])
      tick(d, token, n - 1)
    }
  }
}

/// 探索の時間切れ → 答え合わせ → 終了まで進め、結果の行を返す。
fn finish(d: Driver(PlayerId), exploring: List(Effect(PlayerId))) {
  let #(d, revealed) = driver.wake(d, timer(exploring, exploration_ms))
  let #(_, ended) = driver.wake(d, timer(revealed, reveal_ms))
  standings(ended)
}

fn standings(effects: List(Effect(PlayerId))) -> List(Standing(PlayerId)) {
  let assert [rows] =
    list.filter_map(effects, fn(effect) {
      case effect {
        driver.Finish(_, rows) -> Ok(rows)
        _ -> Error(Nil)
      }
    })
  rows
}

fn detail(
  rows: List(Standing(PlayerId)),
  id: String,
  key: String,
) -> Result(String, Nil) {
  let assert Ok(row) = list.find(rows, fn(row) { row.player == PlayerId(id) })
  list.key_find(row.details, key)
}

fn missed_of(rows: List(Standing(PlayerId)), id: String) -> Int {
  let assert Ok(text) = detail(rows, id, "見逃し")
  let assert Ok(value) = int.parse(text)
  value
}

// --- 見逃しポイント ---------------------------------------------------------------

/// 探索の開始に 0.5 秒のタイマーを張り、起きるたびに張り直す。ポイントは結果の行に載り、起きた回数に
/// 比例する（動かない間は、毎回同じだけ足す）。
pub fn missed_points_accumulate_every_tick_test() {
  let #(d, exploring, token) = to_exploration()
  let none = finish(d, exploring)
  let once = finish(tick(d, token, 1), exploring)
  let twice = finish(tick(d, token, 2), exploring)
  missed_of(none, "b") |> should.equal(0)
  missed_of(twice, "b") |> should.equal(2 * missed_of(once, "b"))
  missed_of(twice, "c") |> should.equal(2 * missed_of(once, "c"))
  // 玄関の近くに隠れた b は、圏内（6 m 以内）なのでポイントがある。
  { missed_of(once, "b") > 0 } |> should.be_true
}

/// 人間の鬼の視界の報告に入っている隠れ側は、圏内だけより高く足される。
pub fn sight_report_raises_points_test() {
  let #(d, exploring, token) = to_exploration()
  let plain = finish(tick(d, token, 1), exploring)
  let #(seen, reported) = send(d, "a", sight(["b"]))
  // 報告は誰にも送り返さない。
  reported |> should.equal([])
  let sighted = finish(tick(seen, token, 1), exploring)
  { missed_of(sighted, "b") > missed_of(plain, "b") } |> should.be_true
  missed_of(sighted, "c") |> should.equal(missed_of(plain, "c"))
}

/// 探索が終わったら（答え合わせに入ったら）、古いタイマーが起きても足さず、張り直さない。
pub fn missed_timer_stops_after_exploration_test() {
  let #(d, exploring, token) = to_exploration()
  let #(d, revealed) = driver.wake(d, timer(exploring, exploration_ms))
  let #(d, stale) = driver.wake(d, token)
  timers(stale, game.missed_tick_ms) |> should.equal([])
  let #(_, ended) = driver.wake(d, timer(revealed, reveal_ms))
  missed_of(standings(ended), "b") |> should.equal(0)
}

// --- いいね ----------------------------------------------------------------------

/// 答え合わせの間のいいねで、いいねの数の通知が全員へ届く。2回目と、自分へのいいねでは届かない。
pub fn likes_are_broadcast_once_per_sender_test() {
  let #(d, exploring, _) = to_exploration()
  let #(d, _) = driver.wake(d, timer(exploring, exploration_ms))
  let #(d, liked) = send(d, "b", like("c"))
  let assert [notice] = broadcasts(liked, "likes")
  missed_events.decode_likes(notice)
  |> should.equal(Ok([#("b", 0), #("c", 1)]))
  let #(d, again) = send(d, "b", like("c"))
  broadcasts(again, "likes") |> should.equal([])
  let #(d, own) = send(d, "c", like("c"))
  broadcasts(own, "likes") |> should.equal([])
  let #(_, oni) = send(d, "a", like("b"))
  let assert [notice] = broadcasts(oni, "likes")
  missed_events.decode_likes(notice)
  |> should.equal(Ok([#("b", 1), #("c", 1)]))
}

/// 探索中のいいねは、受け付けない（通知も出ない）。
pub fn likes_during_exploration_are_ignored_test() {
  let #(d, _, _) = to_exploration()
  let #(_, liked) = send(d, "b", like("c"))
  broadcasts(liked, "likes") |> should.equal([])
}

/// 答え合わせの間に入り直した人には、いいねがあれば、本人宛てで今の数が届く。
pub fn likes_are_resent_on_subscribe_test() {
  let #(d, exploring, _) = to_exploration()
  let #(d, _) = driver.wake(d, timer(exploring, exploration_ms))
  let before = driver.subscribed(d, PlayerId("c"))
  likes_delivered(before) |> should.equal([])
  let #(d, _) = send(d, "b", like("c"))
  let assert [notice] = likes_delivered(driver.subscribed(d, PlayerId("c")))
  missed_events.decode_likes(notice)
  |> should.equal(Ok([#("b", 0), #("c", 1)]))
}

fn likes_delivered(effects: List(Effect(PlayerId))) -> List(Dynamic) {
  list.filter_map(effects, fn(effect) {
    case effect {
      driver.Deliver(_, p) ->
        case decode.run(p, decode.at(["type"], decode.string)) {
          Ok("likes") -> Ok(p)
          _ -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

// --- 結果の行 ---------------------------------------------------------------------

/// 結果の行の隠れ側に、見逃しといいねが載る。鬼の行には載らない。勝敗（順位・score）は変わらない。
pub fn standings_include_missed_and_likes_test() {
  let #(d, exploring, token) = to_exploration()
  let plain = finish(d, exploring)
  let d = tick(d, token, 3)
  let #(d, revealed) = driver.wake(d, timer(exploring, exploration_ms))
  let #(d, _) = send(d, "a", like("b"))
  let #(d, _) = send(d, "c", like("b"))
  let #(_, ended) = driver.wake(d, timer(revealed, reveal_ms))
  let rows = standings(ended)
  detail(rows, "b", "いいね") |> should.equal(Ok("2"))
  detail(rows, "c", "いいね") |> should.equal(Ok("0"))
  { missed_of(rows, "b") > 0 } |> should.be_true
  detail(rows, "a", "見逃し") |> should.equal(Error(Nil))
  detail(rows, "a", "いいね") |> should.equal(Error(Nil))
  // 順位と score は、ポイントもいいねも無いときと同じ。
  list.map(rows, fn(row) { #(row.player, row.rank, row.score) })
  |> should.equal(
    list.map(plain, fn(row) { #(row.player, row.rank, row.score) }),
  )
}
