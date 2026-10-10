import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleam/string
import gleeunit/should
import rondo_server/games/veryare/game
import rondo_server/games/veryare/grid
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/room.{
  type Settings, HiderCpus, NoCpu, OniCpu, Settings,
} as veryare
import rondo_server/games/veryare/spread
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/stage_notice
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
    reload_ms: 3000,
  )
}

fn open_room(
  ids: List(String),
  durations: game.Durations,
) -> #(Subject(Message), process.Pid) {
  open_room_with(
    ids,
    durations,
    Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
  )
}

fn open_room_with(
  ids: List(String),
  durations: game.Durations,
  settings: Settings,
) -> #(Subject(Message), process.Pid) {
  let spec =
    veryare.spec_with(RoomId("v"), settings, durations, fn(_size) { 0 })
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
    // ステージの通知（issue-29a）は、ここでは読み飛ばす（next_stage で読む）。
    Ok(GameState(game_type: "veryare", room_id: "v", payload:)) ->
      case is_stage(payload) {
        True -> next_state(outbox)
        False -> payload
      }
    Ok(message.GameStateTo(game_type: "veryare", room_id: "v", payload:, ..)) ->
      case is_stage(payload) {
        True -> next_state(outbox)
        False -> panic as { "unexpected: " <> string.inspect(payload) }
      }
    Ok(message.GameStarted(..))
    | Ok(message.PlayerJoined(..))
    | Ok(message.PlayerLeft(..)) -> next_state(outbox)
    other -> panic as { "unexpected: " <> string.inspect(other) }
  }
}

/// next_state で読み飛ばす通知か。ステージの通知（issue-29a）と、襖の通知（issue-29b）は、
/// それぞれ next_stage・next_doors で読む。
fn is_stage(payload: Dynamic) -> Bool {
  case
    decode.run(payload, decode.field("type", decode.string, decode.success))
  {
    Ok("stage") | Ok("doors") -> True
    _ -> False
  }
}

/// 次に届くステージの通知（全員宛て・本人宛てのどちらでも）。ほかの電文は読み飛ばす。
fn next_stage(outbox: Subject(ServerMessage)) -> Dynamic {
  case process.receive(outbox, 500) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) ->
      case
        decode.run(payload, decode.field("type", decode.string, decode.success))
        == Ok("stage")
      {
        True -> payload
        False -> next_stage(outbox)
      }
    Ok(_) -> next_stage(outbox)
    Error(Nil) -> panic as "ステージの通知が届かない"
  }
}

/// 次に届く game-state の payload（待つ時間を指定する）。
fn next_state_within(outbox: Subject(ServerMessage), ms: Int) -> Dynamic {
  case process.receive(outbox, ms) {
    Ok(GameState(game_type: "veryare", room_id: "v", payload:)) ->
      case is_stage(payload) {
        True -> next_state_within(outbox, ms)
        False -> payload
      }
    other -> panic as { "unexpected: " <> string.inspect(other) }
  }
}

/// 次に届くフェーズ通知の phase 名。間に届く一覧（hiding）は読み飛ばす。
fn next_phase(outbox: Subject(ServerMessage)) -> String {
  let payload = next_state(outbox)
  case field(payload, "type", decode.string) {
    "hiding" -> next_phase(outbox)
    _ -> field(payload, "phase", decode.string)
  }
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
  veryare.parse_settings(None)
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Normal)))
  veryare.parse_settings(Some(dynamic.properties([])))
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Normal)))
}

/// 選択肢の値は受け付ける。
pub fn choices_are_accepted_test() {
  list.each(veryare.exploration_choices, fn(seconds) {
    veryare.parse_settings(Some(settings(dynamic.int(seconds))))
    |> should.equal(Ok(Settings(seconds, NoCpu, oni_cpu.Normal)))
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
  // 探索の開始と同時に、隠れ側の状態が一括で届く（ADR 0025 / 0035）。
  field(next_state(a), "type", decode.string) |> should.equal("hiders")

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
      reload_ms: 3000,
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
  // 隠れ側が決まった一覧（hiding）を読む。
  let _hiding = next_state(b)

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

// --- CPU（issue-33） ---------------------------------------------------------

fn cpu_setting(value: Dynamic) -> Dynamic {
  dynamic.properties([#(dynamic.string("cpu"), value)])
}

/// CPU の選択肢は なし(0)・隠れ側 CPU 1〜3体(1〜3)・鬼 CPU(4)。省略時はなし。
pub fn cpu_choices_are_parsed_test() {
  veryare.cpu_choices |> should.equal([0, 1, 2, 3, 4])
  veryare.parse_settings(Some(cpu_setting(dynamic.int(0))))
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Normal)))
  veryare.parse_settings(Some(cpu_setting(dynamic.int(2))))
  |> should.equal(Ok(Settings(40, HiderCpus(2), oni_cpu.Normal)))
  veryare.parse_settings(Some(cpu_setting(dynamic.int(4))))
  |> should.equal(Ok(Settings(40, OniCpu, oni_cpu.Normal)))
  list.each([-1, 5, 9], fn(value) {
    veryare.parse_settings(Some(cpu_setting(dynamic.int(value))))
    |> should.equal(Error(Nil))
  })
  veryare.parse_settings(Some(cpu_setting(dynamic.string("oni"))))
  |> should.equal(Error(Nil))
}

/// CPU は cpu-N・「CPU N」の参加者としてルームにいて、定員に数える。
pub fn cpus_join_the_room_as_members_test() {
  let #(room, _) =
    open_room_with([], quick(1000), Settings(60, HiderCpus(3), oni_cpu.Normal))
  let state = room_actor.snapshot(room)
  state.players
  |> list.map(fn(p) { #(p.id, p.name) })
  |> list.sort(fn(a, b) { string.compare(a.1, b.1) })
  |> should.equal([
    #(PlayerId("cpu-1"), "CPU 1"),
    #(PlayerId("cpu-2"), "CPU 2"),
    #(PlayerId("cpu-3"), "CPU 3"),
  ])
  // 人間は残り2人まで。
  room_actor.join(room, Player(PlayerId("a"), "a")) |> should.equal(Ok(Nil))
  room_actor.join(room, Player(PlayerId("b"), "b")) |> should.equal(Ok(Nil))
  room_actor.join(room, Player(PlayerId("c"), "c"))
  |> should.equal(Error(RoomFull))
}

/// 1人の人間と隠れ側 CPU だけで始められ、探索開始時に CPU の状態が全員へ届く。
pub fn one_human_and_hider_cpus_can_play_test() {
  let #(room, _) =
    open_room_with(["a"], quick(30), Settings(60, HiderCpus(2), oni_cpu.Normal))
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  // CPU を数えて2人以上なので、最初から緑（開始）。
  field(next_state(a), "area", decode.string) |> should.equal("ready")

  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  let preparation = next_state(a)
  field(preparation, "oni", decode.string) |> should.equal("a")
  next_phase(a) |> should.equal("painting")
  next_phase(a) |> should.equal("exploration")

  let hiders = next_state(a)
  field(hiders, "type", decode.string) |> should.equal("hiders")
  let entries =
    field(
      hiders,
      "hiders",
      decode.list({
        use id <- decode.field("playerId", decode.string)
        use pose <- decode.field("pose", decode.string)
        use kind <- decode.subfield(["paint", "kind"], decode.string)
        use color <- decode.subfield(["paint", "color"], decode.string)
        use _x <- decode.field("x", decode.float)
        use _z <- decode.field("z", decode.float)
        use _facing <- decode.field("facing", decode.float)
        decode.success(#(id, pose, kind, string.length(color)))
      }),
    )
  entries
  |> list.map(fn(entry) { entry.0 })
  |> list.sort(string.compare)
  |> should.equal(["cpu-1", "cpu-2"])
  list.each(entries, fn(entry) {
    list.contains(["standing", "crouching", "lying"], entry.1)
    |> should.be_true
    entry.2 |> should.equal("uniform")
    entry.3 |> should.equal(7)
  })
}

/// 人間の隠れ側は、向き・ポーズ・ペイントがまだ無いので null で載る（issue-25 で足す）。
pub fn human_hiders_are_listed_with_null_state_test() {
  let #(room, _) = open_room(["a", "b"], quick(30))
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(a)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  next_phase(a) |> should.equal("preparation")
  next_phase(a) |> should.equal("painting")
  next_phase(a) |> should.equal("exploration")
  let hiders = next_state(a)
  let entries =
    field(
      hiders,
      "hiders",
      decode.list({
        use id <- decode.field("playerId", decode.string)
        use pose <- decode.field("pose", decode.optional(decode.string))
        use paint <- decode.field("paint", decode.optional(decode.dynamic))
        use facing <- decode.field("facing", decode.optional(decode.float))
        decode.success(#(id, pose, paint, facing))
      }),
    )
  entries |> should.equal([#("b", None, None, None)])
}

/// 鬼 CPU を選ぶと、抽選をせずに CPU が鬼になる。
pub fn oni_cpu_becomes_oni_test() {
  let #(room, _) =
    open_room_with(["a"], quick(30), Settings(60, OniCpu, oni_cpu.Normal))
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(a)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  let preparation = next_state(a)
  field(preparation, "phase", decode.string) |> should.equal("preparation")
  field(preparation, "oni", decode.string) |> should.equal("cpu-1")
}

// --- 鬼 CPU（issue-34） -------------------------------------------------------

fn strength_setting(value: Dynamic) -> Dynamic {
  dynamic.properties([#(dynamic.string("cpuStrength"), value)])
}

/// 鬼 CPU の強さは よわい(0)・ふつう(1)・つよい(2)。省略時はふつう。
pub fn cpu_strength_choices_are_parsed_test() {
  veryare.cpu_strength_choices |> should.equal([0, 1, 2])
  veryare.parse_settings(None)
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Normal)))
  veryare.parse_settings(Some(strength_setting(dynamic.int(0))))
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Weak)))
  veryare.parse_settings(Some(strength_setting(dynamic.int(2))))
  |> should.equal(Ok(Settings(40, NoCpu, oni_cpu.Strong)))
  veryare.parse_settings(Some(strength_setting(dynamic.int(3))))
  |> should.equal(Error(Nil))
}

/// 鬼 CPU は探索中、0.5秒ごとに歩き、鬼の状態（位置・向き・ポーズ・開いた襖）を
/// 全員へ送り続ける。
pub fn oni_cpu_broadcasts_its_state_during_exploration_test() {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 30,
      painting_ms: 30,
      exploration_ms: 60_000,
      reveal_ms: 60_000,
      reload_ms: 3000,
    )
  let #(room, _) =
    open_room_with(["a"], durations, Settings(60, OniCpu, oni_cpu.Normal))
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(a)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  next_phase(a) |> should.equal("preparation")
  next_phase(a) |> should.equal("painting")
  next_phase(a) |> should.equal("exploration")
  field(next_state(a), "type", decode.string) |> should.equal("hiders")

  let read = fn(payload) {
    field(payload, "type", decode.string) |> should.equal("oni")
    field(payload, "playerId", decode.string) |> should.equal("cpu-1")
    field(payload, "pose", decode.string) |> should.equal("standing")
    let _doors = field(payload, "openDoors", decode.list(decode.dynamic))
    #(field(payload, "x", decode.float), field(payload, "z", decode.float))
  }
  let first = read(next_state_within(a, 2000))
  let _ = read(next_state_within(a, 2000))
  let _ = read(next_state_within(a, 2000))
  let fourth = read(next_state_within(a, 2000))
  { first != fourth } |> should.be_true
}

// --- 観戦（issue-28） -----------------------------------------------------------

fn move_facing(x: Float, z: Float, facing: Float) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("move")),
    #(dynamic.string("x"), dynamic.float(x)),
    #(dynamic.string("z"), dynamic.float(z)),
    #(dynamic.string("facing"), dynamic.float(facing)),
  ])
}

fn hiding_ids(payload: Dynamic) -> List(String) {
  field(payload, "type", decode.string) |> should.equal("hiding")
  field(payload, "playerIds", decode.list(decode.string))
  |> list.sort(string.compare)
}

/// a が鬼の部屋を、探索フェーズまで進める（隠れ側の一括配信まで読む）。
fn to_exploration(ids: List(String)) {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 30,
      painting_ms: 30,
      exploration_ms: 60_000,
      reveal_ms: 60_000,
      reload_ms: 3000,
    )
  let #(room, _) = open_room(ids, durations)
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  let _selection = next_state(a)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  let _counting = next_state(a)
  next_phase(a) |> should.equal("preparation")
  #(room, a)
}

/// 準備移動の始まりに、まだ隠れている隠れ側の一覧が全員へ届く。
pub fn hiding_list_is_sent_when_hiders_are_decided_test() {
  let #(_room, a) = to_exploration(["a", "b", "c"])
  hiding_ids(next_state(a)) |> should.equal(["b", "c"])
}

/// 被りで失格すると、一覧から外れた知らせが全員へ届く（失格者も観戦になる）。
pub fn disqualified_hiders_leave_the_hiding_list_test() {
  let #(room, a) = to_exploration(["a", "b", "c"])
  let _start = next_state(a)
  // b を c と同じ場所へ動かして被らせる。
  room_actor.game_event(room, PlayerId("c"), move(1.0, 1.0))
  room_actor.game_event(room, PlayerId("b"), move(1.0, 1.0))
  let after = next_state(a)
  // 全員失格で鬼の勝ち（答え合わせ）の知らせと、空になった一覧が届く。
  field(after, "phase", decode.string) |> should.equal("reveal")
  hiding_ids(next_state(a)) |> should.equal([])
}

/// 人間の鬼は、探索中に動くたびに、位置と向きを全員へ送る（鬼 CPU と同じ形）。
pub fn human_oni_state_is_broadcast_during_exploration_test() {
  let #(room, a) = to_exploration(["a", "b"])
  let _hiding = next_state(a)
  // ペイント中の鬼の移動（待機ルーム）は送らない。
  next_phase(a) |> should.equal("painting")
  next_phase(a) |> should.equal("exploration")
  field(next_state(a), "type", decode.string) |> should.equal("hiders")

  // 鬼は玄関に現れるので、玄関から一直線に着ける場所へ動く。
  let assert [#(x, z), ..] = room_spots(1)
  room_actor.game_event(room, PlayerId("a"), move_facing(x, z, 0.5))
  let oni = next_state(a)
  field(oni, "type", decode.string) |> should.equal("oni")
  field(oni, "playerId", decode.string) |> should.equal("a")
  field(oni, "x", decode.float) |> should.equal(x)
  field(oni, "z", decode.float) |> should.equal(z)
  field(oni, "facing", decode.float) |> should.equal(0.5)
  field(oni, "pose", decode.string) |> should.equal("standing")
  field(oni, "openDoors", decode.list(decode.dynamic)) |> should.equal([])

  // 隠れ側の移動の報告（動けない）では、鬼の状態は送らない。
  room_actor.game_event(room, PlayerId("b"), move_facing(0.0, 0.0, 0.0))
  let _ = room_actor.snapshot(room)
  process.receive(a, 50) |> should.equal(Error(Nil))
}

// --- ゲーム終了の通知（issue-42） ------------------------------------------------

/// 次に届く game-ended の結果。それまでの通知は読み飛ばす。
fn next_ended(outbox: Subject(ServerMessage)) -> message.RealtimeResult {
  case process.receive(outbox, 2000) {
    Ok(message.GameEnded(game_type: "veryare", room_id: "v", result:)) -> result
    Ok(_) -> next_ended(outbox)
    Error(Nil) -> panic as "game-ended が届かない"
  }
}

/// 受信箱に game-ended が無い（届いている通知をすべて読んで確かめる）。
fn no_ended(outbox: Subject(ServerMessage)) -> Nil {
  case process.receive(outbox, 0) {
    Ok(message.GameEnded(..)) -> panic as "game-ended が届いた"
    Ok(_) -> no_ended(outbox)
    Error(Nil) -> Nil
  }
}

/// 結果の各行を (playerId, name, rank, 結果) にする。
fn rows(
  result: message.RealtimeResult,
) -> List(#(String, String, Int, String)) {
  list.map(result.rankings, fn(entry) {
    let outcome = case entry.result.details {
      Some(details) ->
        case list.key_find(details, "結果") {
          Ok(message.DetailText(text)) -> text
          _ -> ""
        }
      None -> ""
    }
    #(entry.player_id, entry.name, entry.rank, outcome)
  })
}

/// 状態の値（隠れ側だけ）を playerId ごとに返す。
fn statuses(result: message.RealtimeResult) -> List(#(String, String)) {
  list.filter_map(result.rankings, fn(entry) {
    case entry.result.details {
      Some(details) ->
        case list.key_find(details, "状態") {
          Ok(message.DetailText(text)) -> Ok(#(entry.player_id, text))
          _ -> Error(Nil)
        }
      None -> Error(Nil)
    }
  })
}

/// 表示名つきで部屋を開き、全員の送信先を登録する（案内は読み飛ばす）。
fn open_named(
  ids: List(String),
  durations: game.Durations,
) -> #(Subject(Message), List(#(String, Subject(ServerMessage)))) {
  let spec =
    veryare.spec_with(
      RoomId("v"),
      Settings(exploration_seconds: 60, cpu: NoCpu, strength: oni_cpu.Normal),
      durations,
      fn(_size) { 0 },
    )
  let assert Ok(started) = room_actor.start(spec)
  let room = started.data
  let outboxes =
    list.map(ids, fn(id) {
      let assert Ok(Nil) =
        room_actor.join(room, Player(PlayerId(id), "name-" <> id))
      let outbox = subscribe(room, id)
      // 入室後の案内（room-info）を読み飛ばす。
      let _info = next_state(outbox)
      #(id, outbox)
    })
  #(room, outboxes)
}

fn outbox_of(
  outboxes: List(#(String, Subject(ServerMessage))),
  id: String,
) -> Subject(ServerMessage) {
  let assert Ok(outbox) = list.key_find(outboxes, id)
  outbox
}

/// 指定のフェーズの通知が届くまで読む（鬼選出の色の変化などは読み飛ばす）。
fn until_phase(outbox: Subject(ServerMessage), name: String) -> Nil {
  case next_phase(outbox) == name {
    True -> Nil
    False -> until_phase(outbox, name)
  }
}

/// a がエリアに触れて鬼になるまで進める。
fn start_with_oni_a(room: Subject(Message)) -> Nil {
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
}

/// 部屋のステージ（乱数を 0 に固定しているので stage.generate(0)）で、玄関から一直線に
/// 着ける、別々の場所（issue-29a。玄関に全員が現れるので、被らないよう動かす）。
fn room_spots(count: Int) -> List(#(Float, Float)) {
  let layout = stage.generate(0)
  spread.spots(grid.of_layout(layout), layout.skeleton.spawn, count, 7.0)
}

/// 準備移動の間に、ids の隠れ側を別々の場所へ動かす（移動の報告を送る）。
fn spread_in_room(room: Subject(Message), ids: List(String)) -> Nil {
  list.zip(ids, room_spots(list.length(ids)))
  |> list.each(fn(pair) {
    let #(id, #(x, z)) = pair
    room_actor.game_event(room, PlayerId(id), move(x, z))
  })
}

fn durations(preparation_ms: Int, exploration_ms: Int) -> game.Durations {
  game.Durations(
    oni_selection_ms: 30,
    preparation_ms:,
    painting_ms: 30,
    exploration_ms:,
    reveal_ms: 30,
    reload_ms: 3000,
  )
}

/// 時間切れ（隠れ側の勝ち）: 答え合わせの後に、全員のソケットへ同じ結果が届く。
/// 順位は勝ちの隠れ側チームが 1 位、鬼が 2 位。名前はルームの表示名。
pub fn game_ended_reaches_everyone_after_reveal_on_time_up_test() {
  let #(room, outboxes) = open_named(["a", "b", "c"], durations(300, 30))
  start_with_oni_a(room)
  until_phase(outbox_of(outboxes, "a"), "preparation")
  spread_in_room(room, ["b", "c"])
  let results = list.map(outboxes, fn(entry) { next_ended(entry.1) })
  let assert [first, ..] = results
  list.each(results, fn(r) { r |> should.equal(first) })
  first.order |> should.equal(message.HigherIsBetter)
  rows(first)
  |> should.equal([
    #("b", "name-b", 1, "勝ち"),
    #("c", "name-c", 1, "勝ち"),
    #("a", "name-a", 2, "負け"),
  ])
  statuses(first) |> should.equal([#("b", "逃げ切り"), #("c", "逃げ切り")])
  room_actor.snapshot(room).status |> should.equal(room_actor.Finished)
}

/// 全員失格（準備移動の終わりの被り）: 鬼の勝ちで、全員へ届く。
pub fn game_ended_is_sent_when_all_hiders_are_disqualified_test() {
  let #(room, outboxes) = open_named(["a", "b", "c"], durations(200, 60_000))
  start_with_oni_a(room)
  until_phase(outbox_of(outboxes, "a"), "preparation")
  room_actor.game_event(room, PlayerId("b"), move(1.0, 1.0))
  room_actor.game_event(room, PlayerId("c"), move(1.0, 1.0))
  list.each(outboxes, fn(entry) {
    let r = next_ended(entry.1)
    rows(r)
    |> should.equal([
      #("a", "name-a", 1, "勝ち"),
      #("b", "name-b", 2, "負け"),
      #("c", "name-c", 2, "負け"),
    ])
    statuses(r)
    |> should.equal([#("b", "発見・失格・離脱"), #("c", "発見・失格・離脱")])
  })
}

/// 隠れ側全員の離脱: 鬼の勝ち。残った鬼に届き、離脱した人には届かない。
/// 離脱した人も、名前つきで結果に残る。
pub fn game_ended_is_sent_when_all_hiders_leave_test() {
  let #(room, outboxes) = open_named(["a", "b", "c"], durations(60_000, 60_000))
  start_with_oni_a(room)
  until_phase(outbox_of(outboxes, "a"), "preparation")
  room_actor.leave(room, PlayerId("b"))
  room_actor.leave(room, PlayerId("c"))
  rows(next_ended(outbox_of(outboxes, "a")))
  |> should.equal([
    #("a", "name-a", 1, "勝ち"),
    #("b", "name-b", 2, "負け"),
    #("c", "name-c", 2, "負け"),
  ])
  let _ = room_actor.snapshot(room)
  no_ended(outbox_of(outboxes, "b"))
  no_ended(outbox_of(outboxes, "c"))
}

/// 鬼の離脱: 隠れ側の勝ちで、残った全員へ届く。離脱した鬼も 2 位で残る。
pub fn game_ended_is_sent_when_the_oni_leaves_test() {
  let #(room, outboxes) = open_named(["a", "b", "c"], durations(60_000, 60_000))
  start_with_oni_a(room)
  until_phase(outbox_of(outboxes, "b"), "preparation")
  room_actor.leave(room, PlayerId("a"))
  list.each(["b", "c"], fn(id) {
    rows(next_ended(outbox_of(outboxes, id)))
    |> should.equal([
      #("b", "name-b", 1, "勝ち"),
      #("c", "name-c", 1, "勝ち"),
      #("a", "name-a", 2, "負け"),
    ])
  })
  let _ = room_actor.snapshot(room)
  no_ended(outbox_of(outboxes, "a"))
}

/// 不成立（鬼選出の時点で2人未満）: 答え合わせを挟まずに届く。全員 1 位・score 0。
pub fn game_ended_is_sent_when_the_game_is_void_test() {
  let #(room, outboxes) = open_named(["a", "b"], durations(60_000, 60_000))
  start_with_oni_a(room)
  room_actor.leave(room, PlayerId("b"))
  let r = next_ended(outbox_of(outboxes, "a"))
  rows(r) |> should.equal([#("a", "name-a", 1, "不成立")])
  let assert [entry] = r.rankings
  entry.result.score |> should.equal(message.IntNumber(0))
}

/// 参加者でない接続には届かない（限定配信と同じく、宛先でない接続には送らない）。
pub fn game_ended_is_not_sent_to_outsiders_test() {
  let #(room, outboxes) = open_named(["a", "b"], quick(30))
  let outsider = subscribe(room, "outsider")
  start_with_oni_a(room)
  let _ = next_ended(outbox_of(outboxes, "a"))
  let _ = room_actor.snapshot(room)
  no_ended(outsider)
}

// --- 射撃（issue-27） -------------------------------------------------------------

fn shoot(target: Dynamic) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("shoot")),
    #(dynamic.string("target"), target),
  ])
}

/// a が鬼の部屋を、探索フェーズが始まるまで進める（隠れ側の一括配信まで読む）。
/// 撃つ間隔は 200 ms に縮める。
fn to_shooting(
  ids: List(String),
) -> #(Subject(Message), Subject(ServerMessage)) {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 300,
      painting_ms: 30,
      exploration_ms: 60_000,
      reveal_ms: 30,
      reload_ms: 200,
    )
  let #(room, _) = open_room(ids, durations)
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  until_phase(a, "preparation")
  spread_in_room(room, list.filter(ids, fn(id) { id != "a" }))
  until_phase(a, "exploration")
  field(next_state(a), "type", decode.string) |> should.equal("hiders")
  // 探索の開始で、襖が全部閉じた通知も届く（issue-29b）。
  next_doors(a) |> should.equal([])
  #(room, a)
}

/// 鬼の射撃の申告（game-event の shoot）で、射程の内側の隠れ側が見つかり、まだ隠れている
/// 一覧が全員へ届く。全員を見つけると鬼の勝ちで終わり、game-ended が届く。
pub fn shooting_finds_hiders_and_ends_with_oni_win_test() {
  let #(room, a) = to_shooting(["a", "b", "c"])
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("b")))
  hiding_ids(next_state(a)) |> should.equal(["c"])
  // 間隔（200 ms）の中の申告は無効。
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("c")))
  let _ = room_actor.snapshot(room)
  process.receive(a, 50) |> should.equal(Error(Nil))
  process.sleep(200)
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("c")))
  let reveal = next_state(a)
  field(reveal, "phase", decode.string) |> should.equal("reveal")
  field(reveal, "outcome", decode.string) |> should.equal("oni-wins")
  let result = next_ended(a)
  rows(result)
  |> should.equal([
    #("a", "a", 1, "勝ち"),
    #("b", "b", 2, "負け"),
    #("c", "c", 2, "負け"),
  ])
}

/// 隠れ側の申告・形の違う申告（target が文字列でも null でもない）は無視する。
pub fn invalid_shots_are_ignored_test() {
  let #(room, a) = to_shooting(["a", "b", "c"])
  room_actor.game_event(room, PlayerId("b"), shoot(dynamic.string("c")))
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.int(1)))
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([#(dynamic.string("type"), dynamic.string("shoot"))]),
  )
  let _ = room_actor.snapshot(room)
  process.receive(a, 50) |> should.equal(Error(Nil))
  // 形の違う申告では間隔も始まらないので、続けて正しく撃てば当たる。
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("b")))
  hiding_ids(next_state(a)) |> should.equal(["c"])
}

/// 狙いなし（null）の申告は外れとして受け付け、間隔を始める。
pub fn shooting_nothing_starts_the_reload_test() {
  let #(room, a) = to_shooting(["a", "b", "c"])
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.nil()))
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("b")))
  let _ = room_actor.snapshot(room)
  process.receive(a, 50) |> should.equal(Error(Nil))
}

// --- ステージの通知（issue-29a） -------------------------------------------------------

/// ルームの開始で、参加者へステージの通知が届く。地図は、部屋のステージそのもの。
pub fn stage_notice_reaches_members_at_start_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let a = subscribe(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  let notice = next_stage(a)
  let assert Ok(decoded) = stage_notice.decode(notice)
  decoded.grid |> should.equal(grid.of_layout(stage.generate(0)))
  decoded.spawn |> should.equal(stage.generate(0).skeleton.spawn)
}

/// 開始の後に送信先を登録した人（途中参加）にも、本人宛てでステージの通知が届く。
pub fn stage_notice_reaches_late_subscribers_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let assert Ok(Nil) = room_actor.start_game(room)
  let b = subscribe(room, "b")
  let assert Ok(_) = stage_notice.decode(next_stage(b))
}

/// 再接続で戻った人のために、ルームへ頼むと、今のステージの通知を本人へ送り直す。
pub fn stage_notice_is_resent_on_resync_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let a = subscribe(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  let _ = next_stage(a)
  room_actor.resync(room, PlayerId("a"))
  let assert Ok(_) = stage_notice.decode(next_stage(a))
  // 参加者でない人には送らない。
  room_actor.resync(room, PlayerId("outsider"))
  let _ = room_actor.snapshot(room)
}

// --- 襖の状態と通知（issue-29b） ---------------------------------------------------------

/// 次に届く、襖の通知の「開いている襖」（全員宛て・本人宛てのどちらでも）。ほかは読み飛ばす。
fn next_doors(outbox: Subject(ServerMessage)) -> List(grid.Edge) {
  case process.receive(outbox, 1000) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) ->
      case stage_notice.decode_doors(payload) {
        Ok(open) -> open |> set.to_list |> list.sort(compare_edges)
        Error(Nil) -> next_doors(outbox)
      }
    Ok(_) -> next_doors(outbox)
    Error(Nil) -> panic as "襖の通知が届かない"
  }
}

fn compare_edges(a: grid.Edge, b: grid.Edge) {
  string.compare(string.inspect(a), string.inspect(b))
}

fn door_event(edge: grid.Edge) -> Dynamic {
  let cell = fn(c: stage.Cell) {
    dynamic.properties([
      #(dynamic.string("x"), dynamic.int(c.x)),
      #(dynamic.string("z"), dynamic.int(c.z)),
    ])
  }
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("open-door")),
    #(
      dynamic.string("door"),
      dynamic.properties([
        #(dynamic.string("a"), cell(edge.a)),
        #(dynamic.string("b"), cell(edge.b)),
      ]),
    ),
  ])
}

fn all_fusuma() -> List(grid.Edge) {
  grid.fusuma(grid.of_layout(stage.generate(0)))
  |> set.to_list
  |> list.sort(compare_edges)
}

/// ルームの開始で、襖の通知が届く（鬼選出の間は、全部開いている）。
pub fn door_notice_reaches_members_at_start_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let a = subscribe(room, "a")
  let assert Ok(Nil) = room_actor.start_game(room)
  next_doors(a) |> should.equal(all_fusuma())
}

/// 探索の開始で全部閉じ、答え合わせの開始で全部開いた、襖の通知が届く。
pub fn doors_close_at_exploration_and_open_at_reveal_test() {
  let #(room, outboxes) = open_named(["a", "b"], durations(300, 300))
  let a = outbox_of(outboxes, "a")
  start_with_oni_a(room)
  until_phase(a, "exploration")
  next_doors(a) |> should.equal([])
  until_phase(a, "reveal")
  next_doors(a) |> should.equal(all_fusuma())
}

/// 鬼が探索中に、襖の近くで開ける報告をすると、開いた襖の通知が全員へ届き、鬼の通知の
/// openDoors も境 {a, b} の形でその襖を載せる。
pub fn opening_a_door_notifies_everyone_test() {
  let #(room, a) = to_shooting(["a", "b"])
  let layout = stage.generate(0)
  let g = grid.of_layout(layout)
  let assert [door, ..] = all_fusuma()
  let corridor = case dict.get(g.regions, door.a) {
    Ok("open") -> door.a
    _ -> door.b
  }
  // 鬼を、玄関から廊下をたどって、襖の手前のマスまで歩かせる（1マスずつ）。
  walk_oni(room, g, layout.skeleton.spawn, corridor)
  room_actor.game_event(room, PlayerId("a"), door_event(door))
  next_doors(a) |> should.equal([door])
  // 同じ襖をもう一度開けても、通知は増えない（開けっぱなし）。
  room_actor.game_event(room, PlayerId("a"), door_event(door))
  let _ = room_actor.snapshot(room)
  room_actor.game_event(
    room,
    PlayerId("a"),
    move_facing(
      int.to_float(corridor.x) +. 0.5,
      int.to_float(corridor.z) +. 0.5,
      1.0,
    ),
  )
  let oni = next_oni(a)
  let assert Ok(open) =
    decode.run(
      oni,
      decode.field("openDoors", decode.list(edge_decoder()), decode.success),
    )
  open |> should.equal([door])
}

/// 開けられない報告（遠い・形が違う）は無視し、通知も出さない。
pub fn invalid_door_reports_are_ignored_test() {
  let #(room, a) = to_shooting(["a", "b"])
  let assert [door, ..] = all_fusuma()
  // 鬼は玄関にいて、襖から遠い。
  room_actor.game_event(room, PlayerId("a"), door_event(door))
  room_actor.game_event(
    room,
    PlayerId("a"),
    dynamic.properties([#(dynamic.string("type"), dynamic.string("open-door"))]),
  )
  let _ = room_actor.snapshot(room)
  process.receive(a, 50) |> should.equal(Error(Nil))
}

/// 送信先を登録した人（途中参加・再接続）にも、今の襖の通知が届く。
pub fn door_notice_reaches_late_subscribers_test() {
  let #(room, _) = open_room(["a", "b"], quick(60_000))
  let assert Ok(Nil) = room_actor.start_game(room)
  let b = subscribe(room, "b")
  next_doors(b) |> should.equal(all_fusuma())
}

fn next_oni(outbox: Subject(ServerMessage)) -> Dynamic {
  let payload = next_state(outbox)
  case field(payload, "type", decode.string) {
    "oni" -> payload
    _ -> next_oni(outbox)
  }
}

fn edge_decoder() -> decode.Decoder(grid.Edge) {
  let cell = {
    use x <- decode.field("x", decode.int)
    use z <- decode.field("z", decode.int)
    decode.success(stage.Cell(x, z))
  }
  use a <- decode.field("a", cell)
  use b <- decode.field("b", cell)
  decode.success(grid.edge(a, b))
}

/// 鬼を from から to のマスまで、歩けるマスを1マスずつたどって動かす（幅優先で道を探す）。
fn walk_oni(
  room: Subject(Message),
  g: grid.Grid,
  from: #(Float, Float),
  to: stage.Cell,
) -> Nil {
  let start = grid.cell_at(g, from)
  path(g, [[start]], set.from_list([start]), to)
  |> list.each(fn(cell) {
    room_actor.game_event(
      room,
      PlayerId("a"),
      move(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5),
    )
  })
}

fn path(
  g: grid.Grid,
  frontier: List(List(stage.Cell)),
  seen: set.Set(stage.Cell),
  to: stage.Cell,
) -> List(stage.Cell) {
  case frontier {
    [] -> panic as "道が無い"
    [route, ..rest] -> {
      let assert [here, ..] = route
      case here == to {
        True -> list.reverse(route)
        False -> {
          let next =
            [#(1, 0), #(-1, 0), #(0, 1), #(0, -1)]
            |> list.map(fn(d) { stage.Cell(here.x + d.0, here.z + d.1) })
            |> list.filter(fn(c) {
              !set.contains(seen, c) && grid.passable(g, set.new(), here, c)
            })
          path(
            g,
            list.append(rest, list.map(next, fn(c) { [c, ..route] })),
            list.fold(next, seen, set.insert),
            to,
          )
        }
      }
    }
  }
}

// --- 入り直した人への隠れ側の通知（issue-29d） ---------------------------------------------

/// a が鬼の部屋を探索の開始まで進め、探索の開始に全員へ届いた隠れ側の通知を返す。
fn to_exploration_with_hiders(
  ids: List(String),
) -> #(Subject(Message), Subject(ServerMessage), Dynamic) {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 300,
      painting_ms: 30,
      exploration_ms: 60_000,
      reveal_ms: 30,
      reload_ms: 200,
    )
  let #(room, _) = open_room(ids, durations)
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  until_phase(a, "preparation")
  spread_in_room(room, list.filter(ids, fn(id) { id != "a" }))
  until_phase(a, "exploration")
  let hiders = next_state(a)
  field(hiders, "type", decode.string) |> should.equal("hiders")
  next_doors(a) |> should.equal([])
  #(room, a, hiders)
}

/// 次に届く、隠れ側の通知（全員宛て・本人宛てのどちらでも）。ほかは読み飛ばす。
fn next_hiders(outbox: Subject(ServerMessage)) -> Dynamic {
  case process.receive(outbox, 1000) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) ->
      case
        decode.run(payload, decode.field("type", decode.string, decode.success))
        == Ok("hiders")
      {
        True -> payload
        False -> next_hiders(outbox)
      }
    Ok(_) -> next_hiders(outbox)
    Error(Nil) -> panic as "隠れ側の通知が届かない"
  }
}

/// 探索中に入り直した人へ、探索の開始に全員へ送ったのと同じ隠れ側の通知を、本人宛てで送り直す。
pub fn hiders_notice_is_resent_to_rejoined_players_test() {
  let #(room, a, hiders) = to_exploration_with_hiders(["a", "b", "c"])
  room_actor.resync(room, PlayerId("a"))
  next_hiders(a) |> should.equal(hiders)
}

/// 見つかった人も、送り直しに載る（探索の開始の時点の一覧から作る）。
pub fn hiders_notice_resent_includes_found_hiders_test() {
  let #(room, a, hiders) = to_exploration_with_hiders(["a", "b", "c"])
  room_actor.game_event(room, PlayerId("a"), shoot(dynamic.string("b")))
  hiding_ids(next_state(a)) |> should.equal(["c"])
  room_actor.resync(room, PlayerId("a"))
  next_hiders(a) |> should.equal(hiders)
}

/// 参加者でない接続には、送り直さない。
pub fn hiders_notice_is_not_resent_to_outsiders_test() {
  let #(room, _a, _hiders) = to_exploration_with_hiders(["a", "b", "c"])
  let outsider = subscribe(room, "outsider")
  room_actor.resync(room, PlayerId("outsider"))
  let _ = room_actor.snapshot(room)
  process.receive(outsider, 50) |> should.equal(Error(Nil))
}

/// 届いている電文を読み捨てる（50 ms 何も届かなくなるまで）。
fn drain(outbox: Subject(ServerMessage)) -> Nil {
  case process.receive(outbox, 50) {
    Ok(_) -> drain(outbox)
    Error(Nil) -> Nil
  }
}

/// 入り直した（resync）後に届いた電文に、隠れ側の通知が無いことを確かめる。
fn no_hiders_on_resync(
  room: Subject(Message),
  outbox: Subject(ServerMessage),
  phase: String,
) -> Nil {
  drain(outbox)
  room_actor.resync(room, PlayerId("a"))
  let _ = room_actor.snapshot(room)
  // 失敗したときに、どのフェーズかが分かるよう、フェーズの名前を添えて確かめる。
  #(phase, list.contains(received_types(outbox, []), "hiders"))
  |> should.equal(#(phase, False))
}

/// 指定のフェーズの通知が届くまで、ほかの電文（隠れ側の通知など）を読み飛ばす。
fn until_phase_skipping(outbox: Subject(ServerMessage), name: String) -> Nil {
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
        _ -> until_phase_skipping(outbox, name)
      }
    Ok(_) -> until_phase_skipping(outbox, name)
    Error(Nil) -> panic as { "フェーズが届かない: " <> name }
  }
}

fn received_types(
  outbox: Subject(ServerMessage),
  acc: List(String),
) -> List(String) {
  case process.receive(outbox, 50) {
    Ok(GameState(payload:, ..)) | Ok(message.GameStateTo(payload:, ..)) -> {
      let kind = case
        decode.run(payload, decode.field("type", decode.string, decode.success))
      {
        Ok(kind) -> kind
        Error(_) -> ""
      }
      received_types(outbox, [kind, ..acc])
    }
    Ok(_) -> received_types(outbox, acc)
    Error(Nil) -> acc
  }
}

/// 探索中と答え合わせ中「以外」（鬼選出・準備移動・ペイント・終了後）は、入り直した人へ
/// 隠れ側の通知を送らない（issue-29d）。
pub fn hiders_notice_is_not_resent_outside_exploration_and_reveal_test() {
  let durations =
    game.Durations(
      oni_selection_ms: 30,
      preparation_ms: 500,
      painting_ms: 500,
      exploration_ms: 30,
      reveal_ms: 30,
      reload_ms: 3000,
    )
  let #(room, _) = open_room(["a", "b"], durations)
  let a = subscribe(room, "a")
  let _info = next_state(a)
  let assert Ok(Nil) = room_actor.start_game(room)
  no_hiders_on_resync(room, a, "oni-selection")
  room_actor.game_event(room, PlayerId("a"), move(0.0, 0.0))
  until_phase(a, "preparation")
  no_hiders_on_resync(room, a, "preparation")
  until_phase(a, "painting")
  no_hiders_on_resync(room, a, "painting")
  until_phase_skipping(a, "ended")
  no_hiders_on_resync(room, a, "ended")
}
