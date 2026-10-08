import gleam/dynamic
import gleam/dynamic/decode
import gleam/erlang/process.{type Subject}
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit/should
import rondo_server/connection/session.{type Session}
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/protocol/message.{
  type ServerMessage, CreateRoom, ErrorMessage, GameEvent, GameStarted,
  GameState, JoinRoom, LeaveRoom, ListRooms, PlayerJoined, PlayerLeft,
  RoomJoined, RoomList, RoomSummary, Session as SessionMessage, SetName, Waiting,
}
import rondo_server/room/room_actor.{PlayerId}
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

// 接続ごとの処理（session）を、ソケットなしで確かめる。各クライアントは自分の送信先
// （outbox = ソケットへの出口）を持ち、返信は handle の戻り値で、ルームからの配信は
// outbox で受け取る。
// --- 補助 ---------------------------------------------------------------

type Client {
  Client(session: Session, outbox: Subject(ServerMessage))
}

fn server() -> session.Deps {
  let assert Ok(supervisor) = room_supervisor.start()
  let assert Ok(directory) =
    room_directory.start(supervisor.data, catalog.room_limits())
  session.Deps(directory: directory.data, timing: timing.Normal)
}

fn connect(deps: session.Deps) -> #(Client, List(ServerMessage)) {
  let outbox = process.new_subject()
  let #(state, replies) = session.start(deps, outbox)
  #(Client(state, outbox), replies)
}

fn client(deps: session.Deps) -> Client {
  connect(deps).0
}

fn send(
  deps: session.Deps,
  client: Client,
  incoming: message.ClientMessage,
) -> #(Client, List(ServerMessage)) {
  let #(state, replies) = session.handle(client.session, deps, incoming)
  #(Client(..client, session: state), replies)
}

fn id_of(client: Client) -> String {
  client.session.player_id
}

/// outbox に届いたものを、届き終わるまで集める。
fn drain(client: Client) -> List(ServerMessage) {
  do_drain(client.outbox, [])
}

fn do_drain(outbox, acc) {
  case process.receive(outbox, 50) {
    Ok(m) -> do_drain(outbox, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

fn phase_fields(messages: List(ServerMessage)) -> List(#(String, String)) {
  list.filter_map(messages, fn(m) {
    case m {
      GameState(payload:, ..) ->
        case
          decode.run(payload, {
            use kind <- decode.field("type", decode.string)
            use phase <- decode.field("phase", decode.string)
            use area <- decode.field("area", decode.optional(decode.string))
            decode.success(#(kind, phase, area))
          })
        {
          Ok(#("phase", phase, area)) -> Ok(#(phase, option.unwrap(area, "-")))
          _ -> Error(Nil)
        }
      _ -> Error(Nil)
    }
  })
}

fn create_veryare(deps, c) -> #(Client, String) {
  let #(c, replies) = send(deps, c, CreateRoom("veryare", None))
  let assert [RoomJoined(room_id:, ..)] = replies
  #(c, room_id)
}

fn settings(seconds: Int) {
  Some(
    dynamic.properties([
      #(dynamic.string("explorationSeconds"), dynamic.int(seconds)),
    ]),
  )
}

// --- 接続（段階 3 / 4） -----------------------------------------------------------

/// 接続すると、本人にだけ session（プレイヤー識別子と復帰トークン）が届く。
pub fn connecting_issues_player_id_and_resume_token_test() {
  let deps = server()
  let #(c, replies) = connect(deps)
  let assert [SessionMessage(player_id:, resume_token:)] = replies
  player_id |> should.equal(id_of(c))
  { player_id != resume_token } |> should.be_true
}

/// 識別子とトークンは推測しにくい（128 ビットの乱数）。接続ごとに違う。
pub fn ids_and_tokens_are_unguessable_and_distinct_test() {
  let deps = server()
  let a = client(deps)
  let b = client(deps)
  { string.length(a.session.player_id) >= 32 } |> should.be_true
  { string.length(a.session.resume_token) >= 32 } |> should.be_true
  { a.session.player_id != b.session.player_id } |> should.be_true
  { a.session.resume_token != b.session.resume_token } |> should.be_true
}

/// 表示名の既定は userN。接続ごとに違う番号になる（ADR 0015）。
pub fn default_names_are_user_n_test() {
  let deps = server()
  let a = client(deps)
  let b = client(deps)
  string.starts_with(a.session.name, "user") |> should.be_true
  { a.session.name != b.session.name } |> should.be_true
}

/// set-name は本人の名前だけを変える。電文の playerId は信じない。
pub fn set_name_changes_only_own_name_test() {
  let deps = server()
  let a = client(deps)
  let b = client(deps)
  let #(a, replies) = send(deps, a, SetName(id_of(b), "  あめ  "))
  replies |> should.equal([])
  a.session.name |> should.equal("あめ")
  // b の名前は変わらない（a が b の ID を書いても無関係）。
  { b.session.name != "あめ" } |> should.be_true
}

/// 空の名前・長すぎる名前は無視する。
pub fn invalid_names_are_ignored_test() {
  let deps = server()
  let a = client(deps)
  let before = a.session.name
  send(deps, a, SetName("", "   ")).0.session.name |> should.equal(before)
  send(deps, a, SetName("", string.repeat("あ", 21))).0.session.name
  |> should.equal(before)
}

// --- ルームの作成・参加・一覧・退出（段階 5） ----------------------------------------

/// veryare のルームを作ると、自分だけのルームに入り、入室後の案内と最初の通知が届く。
pub fn creating_veryare_room_joins_and_starts_it_test() {
  let deps = server()
  let a = client(deps)
  let #(a, replies) = send(deps, a, CreateRoom("veryare", settings(60)))
  let assert [RoomJoined(game_type: "veryare", room_id: _, you:, players:)] =
    replies
  you |> should.equal(id_of(a))
  list.map(players, fn(p) { p.player_id }) |> should.equal([id_of(a)])

  // 1人なので鬼希望エリアは赤（待機）。
  phase_fields(drain(a)) |> should.equal([#("oni-selection", "waiting")])
}

/// 2人目が参加すると、2人ともにフェーズ通知が届く（緑・開始）。1人目には参加の知らせ。
pub fn second_player_joining_notifies_both_test() {
  let deps = server()
  let #(a, room_id) = create_veryare(deps, client(deps))
  let _ = drain(a)

  let b = client(deps)
  let #(b, replies) = send(deps, b, JoinRoom("veryare", room_id))
  let assert [RoomJoined(you:, players:, ..)] = replies
  you |> should.equal(id_of(b))
  list.length(players) |> should.equal(2)

  let to_a = drain(a)
  list.any(to_a, fn(m) {
    case m {
      PlayerJoined(player:, ..) -> player.player_id == id_of(b)
      _ -> False
    }
  })
  |> should.be_true
  phase_fields(to_a) |> should.equal([#("oni-selection", "ready")])

  // b にも入室後の案内と、今の通知（緑）が届く。
  let to_b = drain(b)
  phase_fields(to_b) |> should.equal([#("oni-selection", "ready")])
}

/// ゲーム内イベントは自分のルームにだけ届く。b がエリアに触れると2人とも青になる。
pub fn game_events_reach_own_room_test() {
  let deps = server()
  let #(a, room_id) = create_veryare(deps, client(deps))
  let #(b, _) = send(deps, client(deps), JoinRoom("veryare", room_id))
  let _ = drain(a)
  let _ = drain(b)

  let touch =
    dynamic.properties([
      #(dynamic.string("type"), dynamic.string("move")),
      #(dynamic.string("x"), dynamic.float(0.0)),
      #(dynamic.string("z"), dynamic.float(0.0)),
    ])
  // 別のルーム宛てのイベントは無視される。
  let _ = send(deps, b, GameEvent("veryare", "room-other", touch))
  phase_fields(drain(a)) |> should.equal([])

  let _ = send(deps, b, GameEvent("veryare", room_id, touch))
  phase_fields(drain(a)) |> should.equal([#("oni-selection", "counting")])
  phase_fields(drain(b)) |> should.equal([#("oni-selection", "counting")])
}

/// 限定配信は宛先の接続（outbox = ソケット）にだけ届き、同じルームの他の接続には届かない。
pub fn targeted_delivery_reaches_only_the_target_socket_test() {
  let deps = server()
  let #(a, room_id) = create_veryare(deps, client(deps))
  let #(b, _) = send(deps, client(deps), JoinRoom("veryare", room_id))
  let _ = drain(a)
  let _ = drain(b)

  let assert Ok(room) = room_directory.find(deps.directory, room_id)
  room_actor.send_to(room, [PlayerId(id_of(b))], dynamic.string("secret"))

  drain(a) |> should.equal([])
  let assert [message.GameStateTo(to:, ..)] = drain(b)
  to |> should.equal(id_of(b))
}

/// ルーム一覧には人数・定員・状態だけが載り、探索時間は含まれない（ADR 0024）。
pub fn room_list_hides_exploration_time_test() {
  let deps = server()
  let #(_a, room_id) = create_veryare(deps, client(deps))

  let #(_, replies) = send(deps, client(deps), ListRooms("veryare"))
  let assert [RoomList(game_type: "veryare", rooms:)] = replies
  rooms
  |> should.equal([
    RoomSummary(
      room_id:,
      game_type: "veryare",
      player_count: 1,
      capacity: 5,
      status: Waiting,
    ),
  ])

  let assert [listing] = replies
  let encoded = message.encode_server(listing)
  string.contains(encoded, "exploration") |> should.be_false
}

/// 定員は5人。6人目は room-full で断られる（ADR 0030）。
pub fn sixth_player_is_rejected_as_room_full_test() {
  let deps = server()
  let #(_a, room_id) = create_veryare(deps, client(deps))
  list.each([1, 2, 3, 4], fn(_) {
    let #(_, replies) = send(deps, client(deps), JoinRoom("veryare", room_id))
    let assert [RoomJoined(..)] = replies
  })
  let #(_, replies) = send(deps, client(deps), JoinRoom("veryare", room_id))
  let assert [ErrorMessage(code: "room-full", ..)] = replies
}

/// veryare の同時ルームは3つまで。4つ目は room-limit で断られ、Tilt Maze は影響されない。
pub fn fourth_veryare_room_is_rejected_test() {
  let deps = server()
  list.each([1, 2, 3], fn(_) { create_veryare(deps, client(deps)) })
  let #(_, replies) = send(deps, client(deps), CreateRoom("veryare", None))
  let assert [ErrorMessage(code: "room-limit", ..)] = replies

  let #(_, replies) = send(deps, client(deps), CreateRoom("tilt-maze", None))
  let assert [RoomJoined(game_type: "tilt-maze", ..)] = replies
}

/// 知らないゲーム・選択肢にない設定は断る。
pub fn unknown_game_and_invalid_settings_are_rejected_test() {
  let deps = server()
  let #(_, replies) = send(deps, client(deps), CreateRoom("unknown", None))
  let assert [ErrorMessage(code: "unknown-game", ..)] = replies

  let #(_, replies) =
    send(deps, client(deps), CreateRoom("veryare", settings(50)))
  let assert [ErrorMessage(code: "invalid-settings", ..)] = replies
}

/// 存在しないルームへの参加は room-not-found。
pub fn joining_missing_room_is_rejected_test() {
  let deps = server()
  let #(_, replies) = send(deps, client(deps), JoinRoom("veryare", "nope"))
  let assert [ErrorMessage(code: "room-not-found", ..)] = replies
}

/// 1つの接続は同時に1つのルームにだけ入る。
pub fn one_connection_is_in_one_room_at_a_time_test() {
  let deps = server()
  let #(a, _) = create_veryare(deps, client(deps))
  let #(_, replies) = send(deps, a, CreateRoom("tilt-maze", None))
  let assert [ErrorMessage(code: "already-in-room", ..)] = replies
}

/// Tilt Maze は最小人数（2人）がそろった時点で始まり、全員に game-started が届く。
pub fn tilt_maze_starts_when_minimum_is_reached_test() {
  let deps = server()
  let #(a, replies) = send(deps, client(deps), CreateRoom("tilt-maze", None))
  let assert [RoomJoined(room_id:, ..)] = replies
  drain(a) |> should.equal([])

  let #(b, _) = send(deps, client(deps), JoinRoom("tilt-maze", room_id))
  list.contains(drain(a), GameStarted("tilt-maze", room_id)) |> should.be_true
  list.contains(drain(b), GameStarted("tilt-maze", room_id)) |> should.be_true
}

/// 退出すると、残った人に player-left が届き、一覧の人数が減る。
pub fn leaving_notifies_others_and_updates_list_test() {
  let deps = server()
  let #(a, room_id) = create_veryare(deps, client(deps))
  let #(b, _) = send(deps, client(deps), JoinRoom("veryare", room_id))
  let _ = drain(a)

  let #(b, replies) = send(deps, b, LeaveRoom(room_id))
  replies |> should.equal([])
  b.session.room |> should.equal(None)
  list.contains(drain(a), PlayerLeft(room_id, id_of(b))) |> should.be_true

  let #(_, replies) = send(deps, client(deps), ListRooms("veryare"))
  let assert [RoomList(rooms: [RoomSummary(player_count: 1, ..)], ..)] = replies
}

/// 接続が閉じたら、ルームから抜ける（再接続猶予は後半で実装する）。
pub fn closing_connection_leaves_the_room_test() {
  let deps = server()
  let #(a, room_id) = create_veryare(deps, client(deps))
  let #(b, _) = send(deps, client(deps), JoinRoom("veryare", room_id))
  let _ = drain(a)

  session.close(b.session)
  list.contains(drain(a), PlayerLeft(room_id, id_of(b))) |> should.be_true
}
