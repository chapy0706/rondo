//// 観戦ルーム（issue-67 段階 2 の ②）の、ルーム（room_actor）の仕組み。仮のゲームで確かめる。
////
//// 仮のゲームは、開始から 10 ms で、自分で終わる（Finish）。受けたイベントは全員へ流す。次の試合を
//// 作れる（restart）。参加者は CPU だけ（bots）。
////
//// - 観戦ルームに入る人は、すべて観戦者（定員に数えない）。上限を超えたら満員
//// - 観戦者の操作は捨てる（ゲームに届かない）
//// - 全体配信は、観戦者にも届く
//// - 試合が終わると、結果を見せたあと、次の試合が始まる。結果に、閉じるまでの残りは載らない
//// - 観戦者が 0 人のまま一定時間たつと、閉じる。その前に誰かが入れば、閉じない
//// - 対戦のルームは、これまでどおり（観戦者はいない）

import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/protocol/message.{
  type ServerMessage, GameEnded, GameStarted, GameState,
}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{
  type Message, type PlayerId, AlreadyJoined, Player, PlayerId, RoomFull, RoomId,
  RoomSpec, Spectate, SpectateConfig,
}

const next_game_ms = 30

const idle_close_ms = 80

fn text(value: String) -> Dynamic {
  dynamic.string(value)
}

/// 仮のゲーム。round は何試合目か（タイマーの token に使う）。
fn game_driver(round: Int, over: Bool) -> Driver(PlayerId) {
  driver.new(
    on_event: fn(_player, payload) {
      #(game_driver(round, over), [driver.Broadcast(payload)])
    },
    on_leave: fn(_player) { #(game_driver(round, over), []) },
    on_join: fn(_player) { #(game_driver(round, over), []) },
    accepts_join: fn() { False },
    on_wake: fn(token) {
      case token == round {
        // 開始から 10 ms で、自分で終わる。
        True -> #(game_driver(round, True), [
          driver.Finish(message.HigherIsBetter, []),
        ])
        False -> #(game_driver(round, over), [])
      }
    },
    is_over: fn() { over },
  )
  |> driver.on_restart(fn() { Ok(begin(round + 1)) })
}

fn begin(round: Int) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  #(game_driver(round, False), [
    driver.Broadcast(text("round")),
    driver.WakeAfter(10, round),
  ])
}

fn spec() {
  RoomSpec(
    id: RoomId("s"),
    game_type: "echo",
    name: "観戦",
    min_players: 2,
    max_players: 5,
    authority: None,
    driver: Some(fn(_players) { begin(1) }),
    member_info: Some(text("welcome")),
    bots: [
      Player(PlayerId("cpu-1"), "CPU 1"),
      Player(PlayerId("cpu-2"), "CPU 2"),
    ],
    close_after_ms: 40,
  )
}

fn open_spectate(max: Int) -> #(Subject(Message), process.Pid) {
  let assert Ok(started) =
    room_actor.start_with(
      spec(),
      Spectate(SpectateConfig(
        max_spectators: max,
        next_game_ms:,
        idle_close_ms:,
      )),
    )
  #(started.data, started.pid)
}

fn watch(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
  outbox
}

/// 少し待ってから、いま届いている分だけを読む（観戦ルームは試合を回し続けるので、届かなくなるまで
/// 待つ形では、読み終わらない）。
fn drain(outbox: Subject(ServerMessage)) -> List(ServerMessage) {
  process.sleep(20)
  do_drain(outbox, [])
}

fn do_drain(outbox, acc) {
  case process.receive(outbox, 0) {
    Ok(m) -> do_drain(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn payloads(messages: List(ServerMessage)) -> List(Dynamic) {
  list.filter_map(messages, fn(m) {
    case m {
      GameState(payload:, ..) -> Ok(payload)
      _ -> Error(Nil)
    }
  })
}

fn started(messages: List(ServerMessage)) -> Int {
  list.count(messages, fn(m) {
    case m {
      GameStarted(..) -> True
      _ -> False
    }
  })
}

fn ended(messages: List(ServerMessage)) -> List(ServerMessage) {
  list.filter(messages, fn(m) {
    case m {
      GameEnded(..) -> True
      _ -> False
    }
  })
}

fn ids(players: List(room_actor.Player)) -> List(String) {
  list.map(players, fn(p) {
    let PlayerId(id) = p.id
    id
  })
  |> list.sort(string.compare)
}

// --- 観戦者 ----------------------------------------------------------------------

/// 観戦ルームに入る人は、すべて観戦者。参加者（CPU だけ）と定員には数えない。
pub fn joiners_become_spectators_test() {
  let #(room, _) = open_spectate(20)
  let _ = watch(room, "a")
  let _ = watch(room, "b")
  let state = room_actor.snapshot(room)
  state.spectate |> should.be_true
  state.spectators |> should.equal(2)
  state.max_spectators |> should.equal(20)
  ids(state.players) |> should.equal(["cpu-1", "cpu-2"])
}

/// 観戦者の数には上限がある。超えたら満員（room-full）。同じ人が二度入ることはできない。
pub fn spectators_are_limited_test() {
  let #(room, _) = open_spectate(2)
  let _ = watch(room, "a")
  let _ = watch(room, "b")
  room_actor.join_and_subscribe(
    room,
    Player(PlayerId("c"), "c"),
    process.new_subject(),
  )
  |> should.equal(Error(RoomFull))
  room_actor.join_and_subscribe(
    room,
    Player(PlayerId("a"), "a"),
    process.new_subject(),
  )
  |> should.equal(Error(AlreadyJoined))
  room_actor.snapshot(room).spectators |> should.equal(2)
}

/// 観戦者が入ると、入室後の案内が届く。ゲームの全体配信も、観戦者に届く。
pub fn spectators_receive_the_welcome_and_broadcasts_test() {
  let #(room, _) = open_spectate(20)
  let a = watch(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  let got = drain(a)
  payloads(got) |> list.contains(text("welcome")) |> should.be_true
  payloads(got) |> list.contains(text("round")) |> should.be_true
  { started(got) >= 1 } |> should.be_true
}

/// 観戦者の操作は、ゲームに届かない（仮のゲームは、届いたイベントを全員へ流すので、流れてこない）。
pub fn spectator_events_are_dropped_test() {
  let #(room, _) = open_spectate(20)
  let a = watch(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  let _ = drain(a)
  room_actor.game_event(room, PlayerId("a"), text("move"))
  payloads(drain(a)) |> list.contains(text("move")) |> should.be_false
}

// --- 次の試合 ----------------------------------------------------------------------

/// 試合が終わると、結果を見せたあと（next_game_ms）、同じルームの中で次の試合が始まる。結果に、閉じる
/// までの残り（issue-70）は載らない（観戦ルームは、時間で閉じない）。
pub fn next_game_starts_after_the_result_test() {
  let #(room, _) = open_spectate(20)
  let a = watch(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  // 1 試合 = 10 ms + 結果を見せる 30 ms。3 試合ぶん待つ。
  process.sleep(3 * { 10 + next_game_ms } + 20)
  let got = drain(a)
  { started(got) >= 3 } |> should.be_true
  { list.length(ended(got)) >= 3 } |> should.be_true
  list.each(ended(got), fn(m) {
    let assert GameEnded(closes_in_ms:, ..) = m
    closes_in_ms |> should.equal(None)
  })
  // issue-70 の 3 分のタイマー（ここでは 40 ms）は張らないので、試合を回し続けても閉じない。
  room_actor.snapshot(room).spectate |> should.be_true
}

// --- 閉じる ----------------------------------------------------------------------

/// 観戦者が 0 人のまま idle_close_ms たつと、閉じる。
pub fn room_closes_after_staying_empty_test() {
  let #(room, pid) = open_spectate(20)
  let _ = watch(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.leave(room, PlayerId("a"))
  process.sleep(idle_close_ms / 2)
  process.is_alive(pid) |> should.be_true
  process.sleep(idle_close_ms)
  process.is_alive(pid) |> should.be_false
}

/// 0 人になっても、閉じる前に誰かが入れば、閉じない。
pub fn someone_joining_keeps_the_room_open_test() {
  let #(room, pid) = open_spectate(20)
  let _ = watch(room, "a")
  room_actor.leave(room, PlayerId("a"))
  process.sleep(idle_close_ms / 2)
  let _ = watch(room, "b")
  process.sleep(idle_close_ms * 2)
  process.is_alive(pid) |> should.be_true
}

/// 作った後、誰も入らなければ、閉じる（作った人が入る前に接続が切れても、残さない）。
pub fn room_nobody_entered_closes_test() {
  let #(_room, pid) = open_spectate(20)
  process.sleep(idle_close_ms + 50)
  process.is_alive(pid) |> should.be_false
}

// --- 対戦のルーム ------------------------------------------------------------------

/// 対戦のルームは、これまでどおり（入る人は参加者。観戦者はいない）。
pub fn match_rooms_have_no_spectators_test() {
  let assert Ok(started) = room_actor.start(spec())
  let outbox = process.new_subject()
  let assert Ok(Nil) =
    room_actor.join_and_subscribe(
      started.data,
      Player(PlayerId("a"), "a"),
      outbox,
    )
  let state = room_actor.snapshot(started.data)
  state.spectate |> should.be_false
  state.spectators |> should.equal(0)
  ids(state.players) |> should.equal(["a", "cpu-1", "cpu-2"])
}
