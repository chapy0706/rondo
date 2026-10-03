/// 1つの接続（ソケット1本）の状態と、クライアントの電文ごとの処理（issue-31）。
///
/// WebSocket の殻（connection/websocket.gleam）がこれを持ち、受け取った電文を handle に
/// 渡して、戻り値の返信を本人のソケットへ送る。ルームからの配信（フェーズ通知・限定配信・
/// 参加の知らせ）は、接続ごとの送信先 outbox に直接届く。ソケットに依存しないので、
/// 複数のクライアントを模したテストをソケットなしで書ける。
///
/// - 接続時に、プレイヤー識別子と復帰トークンを暗号用の乱数で発行する。識別子はルームの
///   他の人にも見えるが、復帰トークンは本人にだけ送る（再接続の鍵 / connection/session_actor）
/// - 表示名の既定は userN（ADR 0015）。set-name は本人の名前だけを変える
/// - 1つの接続は同時に1つのルームにだけ入る
import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Subject}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import rondo_server/games/catalog.{
  InvalidSettings, StartAtMinimum, StartOnCreate, UnknownGame,
}
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, CreateRoom, ErrorMessage, GameEvent,
  JoinRoom, LeaveRoom, ListRooms, PlayerInfo, Playing, Reconnect, RoomJoined,
  RoomList, RoomSummary, Session as SessionMessage, SetName, Waiting,
}
import rondo_server/room/room_actor.{
  type RoomState, AlreadyJoined, GameAlreadyStarted, Player, PlayerId, RoomFull,
  RoomId,
}
import rondo_server/room/room_directory.{LimitReached, StartFailed}

/// 表示名の長さの上限（文字数）。
const max_name_length = 20

/// 接続が使うサーバー側の部品。
pub type Deps {
  Deps(directory: Subject(room_directory.Message))
}

/// 参加中のルーム。
pub type Joined {
  Joined(game_type: String, room_id: String, room: Subject(room_actor.Message))
}

pub type Session {
  Session(
    player_id: String,
    /// 再接続の復帰キー。本人にだけ送る。
    resume_token: String,
    name: String,
    /// この接続への送信先。ルームの配信はここに届き、ソケットへ流れる。
    outbox: Subject(ServerMessage),
    room: Option(Joined),
  )
}

@external(erlang, "rondo_server_ffi", "random_hex")
fn random_hex(bytes: Int) -> String

@external(erlang, "rondo_server_ffi", "unique_number")
fn unique_number() -> Int

/// 接続を始める。識別子とトークンを発行し、本人に session を返す。
pub fn start(
  _deps: Deps,
  outbox: Subject(ServerMessage),
) -> #(Session, List(ServerMessage)) {
  let session =
    Session(
      player_id: random_hex(16),
      resume_token: random_hex(16),
      name: "user" <> int.to_string(unique_number()),
      outbox:,
      room: None,
    )
  #(session, [SessionMessage(session.player_id, session.resume_token)])
}

/// クライアントの電文を1つ処理する。戻り値は本人への返信。
pub fn handle(
  session: Session,
  deps: Deps,
  incoming: ClientMessage,
) -> #(Session, List(ServerMessage)) {
  case incoming {
    SetName(_, name) -> #(set_name(session, name), [])
    ListRooms(game_type) -> #(session, [list_rooms(deps, game_type)])
    CreateRoom(game_type, settings) ->
      create(session, deps, game_type, settings)
    JoinRoom(game_type, room_id) -> join(session, deps, game_type, room_id)
    LeaveRoom(room_id) -> #(leave(session, room_id), [])
    // 再接続は入口（connection.receive）が先に引き受けて、切断中の接続アクターへ付け替える。
    // ここまで届くのは付け替えに使えない場合だけなので、失敗として返す。
    Reconnect(..) -> #(session, [
      error("reconnect-failed", "前の接続に戻れませんでした。"),
    ])
    GameEvent(game_type, room_id, payload) -> {
      forward(session, game_type, room_id, payload)
      #(session, [])
    }
  }
}

/// ルームから抜ける。再接続猶予が切れたとき（connection/session_actor）に呼ばれる。
pub fn close(session: Session) -> Nil {
  case session.room {
    Some(joined) -> room_actor.leave(joined.room, PlayerId(session.player_id))
    None -> Nil
  }
}

// --- 各電文 ----------------------------------------------------------------

/// 前後の空白を落とし、1〜20文字なら変える。それ以外は無視する。
fn set_name(session: Session, raw: String) -> Session {
  let name = string.trim(raw)
  let length = string.length(name)
  case length >= 1 && length <= max_name_length {
    True -> Session(..session, name:)
    False -> session
  }
}

/// ルーム一覧。人数・定員・参加できるかだけを載せ、探索時間などの設定は載せない。
/// 終わったルームは出さない。
fn list_rooms(deps: Deps, game_type: String) -> ServerMessage {
  let rooms =
    room_directory.rooms(deps.directory, game_type)
    |> list.map(room_actor.snapshot)
    |> list.filter(fn(state) { state.status != room_actor.Finished })
    |> list.map(summary)
  RoomList(game_type:, rooms:)
}

fn summary(state: RoomState) -> message.RoomSummary {
  let RoomId(room_id) = state.id
  RoomSummary(
    room_id:,
    game_type: state.game_type,
    player_count: list.length(state.players),
    capacity: state.max_players,
    status: case state.joinable {
      True -> Waiting
      False -> Playing
    },
  )
}

fn create(
  session: Session,
  deps: Deps,
  game_type: String,
  settings: Option(Dynamic),
) -> #(Session, List(ServerMessage)) {
  use <- not_in_room(session)
  let id = RoomId("room-" <> random_hex(8))
  case catalog.spec_for(game_type, id, settings) {
    Error(UnknownGame) -> #(session, [
      error("unknown-game", "そのゲームはありません。"),
    ])
    Error(InvalidSettings) -> #(session, [
      error("invalid-settings", "ルームの設定が正しくありません。"),
    ])
    Ok(#(spec, policy)) ->
      case room_directory.open(deps.directory, spec) {
        Error(LimitReached) -> #(session, [
          error("room-limit", "いま作れるルームの数が上限に達しています。"),
        ])
        Error(StartFailed) -> #(session, [
          error("server-error", "ルームを作れませんでした。"),
        ])
        Ok(room) -> {
          let RoomId(room_id) = id
          enter(session, game_type, room_id, room, policy)
        }
      }
  }
}

fn join(
  session: Session,
  deps: Deps,
  game_type: String,
  room_id: String,
) -> #(Session, List(ServerMessage)) {
  use <- not_in_room(session)
  let not_found = #(session, [
    error("room-not-found", "そのルームは見つかりませんでした。"),
  ])
  case room_directory.find(deps.directory, room_id) {
    Error(Nil) -> not_found
    Ok(room) ->
      case room_actor.snapshot(room).game_type == game_type {
        False -> not_found
        True ->
          enter(
            session,
            game_type,
            room_id,
            room,
            catalog.start_policy(game_type),
          )
      }
  }
}

/// ルームに入る。参加と同時に送信先を登録し（入室後の案内・参加で起きる通知が届くように）、
/// 開始の仕方に従って始め、本人に room-joined を返す。
fn enter(
  session: Session,
  game_type: String,
  room_id: String,
  room: Subject(room_actor.Message),
  policy: catalog.StartPolicy,
) -> #(Session, List(ServerMessage)) {
  let me = PlayerId(session.player_id)
  case
    room_actor.join_and_subscribe(
      room,
      Player(me, session.name),
      session.outbox,
    )
  {
    Error(RoomFull) -> #(session, [error("room-full", "そのルームは満員です。")])
    Error(AlreadyJoined) -> #(session, [
      error("already-joined", "すでにそのルームに参加しています。"),
    ])
    Error(GameAlreadyStarted) -> #(session, [
      error("game-already-started", "そのルームは始まっています。"),
    ])
    Ok(Nil) -> {
      let state = room_actor.snapshot(room)
      case policy, state.status {
        StartOnCreate, room_actor.Open -> {
          let _ = room_actor.start_game(room)
          Nil
        }
        StartAtMinimum, room_actor.Open ->
          case list.length(state.players) >= state.min_players {
            True -> {
              let _ = room_actor.start_game(room)
              Nil
            }
            False -> Nil
          }
        _, _ -> Nil
      }
      let players =
        list.map(state.players, fn(player) {
          let PlayerId(id) = player.id
          PlayerInfo(player_id: id, name: player.name)
        })
      #(Session(..session, room: Some(Joined(game_type:, room_id:, room:))), [
        RoomJoined(game_type:, room_id:, you: session.player_id, players:),
      ])
    }
  }
}

fn leave(session: Session, room_id: String) -> Session {
  case session.room {
    Some(joined) if joined.room_id == room_id -> {
      room_actor.leave(joined.room, PlayerId(session.player_id))
      Session(..session, room: None)
    }
    _ -> session
  }
}

/// ゲーム内イベントを、自分が入っているルームにだけ流す。宛先が違えば捨てる。
fn forward(
  session: Session,
  game_type: String,
  room_id: String,
  payload: Dynamic,
) -> Nil {
  case session.room {
    Some(joined)
      if joined.room_id == room_id && joined.game_type == game_type
    -> room_actor.game_event(joined.room, PlayerId(session.player_id), payload)
    _ -> Nil
  }
}

// --- 補助 ----------------------------------------------------------------

fn not_in_room(
  session: Session,
  next: fn() -> #(Session, List(ServerMessage)),
) -> #(Session, List(ServerMessage)) {
  case session.room {
    Some(_) -> #(session, [
      error("already-in-room", "すでに別のルームに参加しています。"),
    ])
    None -> next()
  }
}

fn error(code: String, text: String) -> ServerMessage {
  ErrorMessage(code:, message: text)
}
