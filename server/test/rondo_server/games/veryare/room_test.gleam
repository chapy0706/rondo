import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/room.{Settings} as veryare
import rondo_server/protocol/message.{type ServerMessage, GameState}
import rondo_server/room/room_actor.{
  type Message, Player, PlayerId, RoomFull, RoomId,
}

// --- 補助 ---------------------------------------------------------------

/// テスト用の短いフェーズ時間（ミリ秒）。
fn quick(exploration_ms: Int) -> game.Durations {
  game.Durations(
    oni_selection_ms: 30,
    preparation_ms: 30,
    painting_ms: 30,
    exploration_ms:,
    reveal_ms: 30,
  )
}

fn open_room(
  ids: List(String),
  durations: game.Durations,
) -> #(Subject(Message), process.Pid) {
  let spec =
    veryare.spec_with(
      RoomId("v"),
      Settings(exploration_seconds: 60),
      durations,
      fn(_size) { 0 },
    )
  let assert Ok(started) = room_actor.start(spec)
  list.each(ids, fn(id) {
    let assert Ok(Nil) = room_actor.join(started.data, Player(PlayerId(id), id))
  })
  #(started.data, started.pid)
}

fn subscribe(room: Subject(Message), id: String) -> Subject(ServerMessage) {
  let outbox = process.new_subject()
  room_actor.subscribe(room, PlayerId(id), outbox)
  outbox
}

fn field(payload: Dynamic, name: String, decoder: decode.Decoder(a)) -> a {
  let assert Ok(value) =
    decode.run(payload, decode.field(name, decoder, decode.success))
  value
}

/// 次に届く game-state の payload を取り出す（参加・開始の知らせは読み飛ばす）。
fn next_state(outbox: Subject(ServerMessage)) -> Dynamic {
  case process.receive(outbox, 500) {
    Ok(GameState(game_type: "veryare", room_id: "v", payload:)) -> payload
    Ok(message.GameStarted(..))
    | Ok(message.PlayerJoined(..))
    | Ok(message.PlayerLeft(..)) -> next_state(outbox)
    other -> panic as { "unexpected: " <> string.inspect(other) }
  }
}

/// 次に届くフェーズ通知の phase 名。
fn next_phase(outbox: Subject(ServerMessage)) -> String {
  field(next_state(outbox), "phase", decode.string)
}

fn move(x: Float, z: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
  ])
}

fn settings(seconds: Dynamic) -> Dynamic {
  dynamic.properties([#(dynamic.string("explorationSeconds"), seconds)])
}

// --- 作成時の設定（段階 6） -------------------------------------------------

/// 探索時間の選択肢は 20 秒刻みの 40〜120 秒で、基本は 40 秒。
pub fn exploration_choices_are_40_to_120_by_20_test() {
  veryare.exploration_choices |> should.equal([40, 60, 80, 100, 120])
  veryare.default_exploration_seconds |> should.equal(40)
}

/// 設定を省略すると基本の 40 秒になる。
pub fn missing_settings_default_to_40_seconds_test() {
  veryare.parse_settings(None) |> should.equal(Ok(Settings(40)))
  veryare.parse_settings(Some(dynamic.properties([])))
  |> should.equal(Ok(Settings(40)))
}

/// 選択肢の値は受け付ける。
pub fn choices_are_accepted_test() {
  list.each(veryare.exploration_choices, fn(seconds) {
    veryare.parse_settings(Some(settings(dynamic.int(seconds))))
    |> should.equal(Ok(Settings(seconds)))
  })
}

/// 選択肢にない値・数値でない値は拒否する（境界での検証）。
pub fn values_outside_choices_are_rejected_test() {
  list.each([0, 20, 50, 140, -40], fn(seconds) {
    veryare.parse_settings(Some(settings(dynamic.int(seconds))))
    |> should.equal(Error(Nil))
  })
  veryare.parse_settings(Some(settings(dynamic.string("60"))))
  |> should.equal(Error(Nil))
}

/// 探索時間は入室後に初めて分かる（送信先を登録した参加者にだけ届く）。
pub fn exploration_time_is_told_only_after_joining_test() {
  let #(room, _) = open_room(["a", "b"], quick(1000))
  let a = subscribe(room, "a")
  let info = next_state(a)
  field(info, "type", decode.string) |> should.equal("room-info")
  field(info, "explorationSeconds", decode.int) |> should.equal(60)

  let outsider = subscribe(room, "outsider")
  let _ = room_actor.snapshot(room)
  process.receive(outsider, 0) |> should.equal(Error(Nil))
}

// --- 定員（段階 11） --------------------------------------------------------

/// 定員は5人（鬼1・隠れ側4）。6人目は断られる。
pub fn room_capacity_is_five_test() {
  let #(room, _) = open_room(["a", "b", "c", "d", "e"], quick(1000))
  room_actor.join(room, Player(PlayerId("f"), "f"))
  |> should.equal(Error(RoomFull))

  let state = room_actor.snapshot(room)
  state.max_players |> should.equal(5)
  state.min_players |> should.equal(2)
}

// --- フェーズの自動進行 ------------------------------------------------------

/// エリアに触れるとカウントが始まり、鬼選出 → 準備移動 → ペイント → 探索 →
/// 答え合わせ → 終了 が、時間経過だけで順に進む。
pub fn phases_advance_automatically_with_time_test() {
  let #(room, _) = open_room(["a", "b"], quick(30))
  let a = subscribe(room, "a")
  let _info = next_state(a)

  let assert Ok(Nil) = room_actor.start_game(room)
  let selection = next_state(a)
  field(selection, "phase", decode.string) |> should.equal("oni-selection")
  field(selection, "area", decode.string) |> should.equal("ready")

  // 誰も触れない間はカウントしない。a が触れた瞬間に青（カウント中）になる。
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let counting = next_state(a)
  field(counting, "area", decode.string) |> should.equal("counting")
  field(counting, "durationMs", decode.int) |> should.equal(30)

  next_phase(a) |> should.equal("preparation")
  next_phase(a) |> should.equal("painting")
  next_phase(a) |> should.equal("exploration")

  // 誰も見つからないまま探索が時間切れ -> 答え合わせ（隠れ側の勝利）-> 終了。
  let reveal = next_state(a)
  field(reveal, "phase", decode.string) |> should.equal("reveal")
  field(reveal, "outcome", decode.string) |> should.equal("hiders-win")
  room_actor.snapshot(room).status |> should.equal(room_actor.Playing)

  let ended = next_state(a)
  field(ended, "phase", decode.string) |> should.equal("ended")
  field(ended, "outcome", decode.string) |> should.equal("hiders-win")
  room_actor.snapshot(room).status |> should.equal(room_actor.Finished)
}

// --- 鬼選出 -------------------------------------------------------------------

/// 1人でも始められ、そのときエリアは赤（待機）。鬼選出中に2人目が入ると緑（開始）になる。
pub fn joining_during_selection_turns_area_from_waiting_to_ready_test() {
  let #(room, _) = open_room(["a"], quick(1000))
  let a = subscribe(room, "a")
  let _info = next_state(a)

  let assert Ok(Nil) = room_actor.start_game(room)
  field(next_state(a), "area", decode.string) |> should.equal("waiting")

  room_actor.join(room, Player(PlayerId("b"), "b")) |> should.equal(Ok(Nil))
  field(next_state(a), "area", decode.string) |> should.equal("ready")
}

/// 鬼選出が終わった後は入室できない。
pub fn joining_after_selection_is_rejected_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(a)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  next_phase(a) |> should.equal("preparation")

  room_actor.join(room, Player(PlayerId("c"), "c"))
  |> should.equal(Error(room_actor.GameAlreadyStarted))
}

/// 鬼希望エリアへ移動したプレイヤーが立候補者になり、鬼に選ばれる。
pub fn player_moving_into_oni_area_becomes_oni_test() {
  let #(room, _) = open_room(["a", "b", "c"], quick(1000))
  let a = subscribe(room, "a")
  let _info = next_state(a)

  let assert Ok(Nil) = room_actor.start_game(room)
  next_phase(a) |> should.equal("oni-selection")
  room_actor.game_event(room, PlayerId("c"), move(0.0, 0.1))
  let _counting = next_state(a)

  let preparation = next_state(a)
  field(preparation, "phase", decode.string) |> should.equal("preparation")
  field(preparation, "oni", decode.string) |> should.equal("c")
}

// --- 勝敗 ----------------------------------------------------------------------

/// 鬼が猶予を過ぎて離脱すると、探索を待たずに即座に隠れ側の勝利（答え合わせへ）。
pub fn oni_leaving_ends_with_hiders_win_immediately_test() {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 60_000,
      painting_ms: 60_000,
      exploration_ms: 60_000,
      reveal_ms: 60_000,
    )
  let #(room, _) = open_room(["a", "b", "c"], durations)
  let b = subscribe(room, "b")
  let _info = next_state(b)

  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(b)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(b)
  let preparation = next_state(b)
  let oni = field(preparation, "oni", decode.string)

  room_actor.leave(room, PlayerId(oni))
  let reveal = next_state(b)
  field(reveal, "phase", decode.string) |> should.equal("reveal")
  field(reveal, "outcome", decode.string) |> should.equal("hiders-win")
}

// --- ホスト --------------------------------------------------------------------

/// ホスト（最初の参加者）が進行中に抜けても、ルームは続き、残りで遊び続けられる。
pub fn host_leaving_during_game_keeps_room_running_test() {
  let #(room, pid) = open_room(["host", "b", "c"], quick(1000))
  let b = subscribe(room, "b")
  let _info = next_state(b)
  room_actor.snapshot(room).host |> should.equal(Some(PlayerId("host")))

  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(b)
  // 鬼選出中にホストが抜ける（参加者から外れるだけ）。残りの b が触れて進める。
  room_actor.leave(room, PlayerId("host"))
  room_actor.game_event(room, PlayerId("b"), move(0.0, 0.0))
  let _counting = next_state(b)

  let preparation = next_state(b)
  field(preparation, "phase", decode.string) |> should.equal("preparation")
  process.is_alive(pid) |> should.be_true
}
