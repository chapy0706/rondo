/// クライアントとサーバーの間の電文（ADR 0007 / 0009）。
///
/// 契約は TypeScript（packages/contracts/src/messages.ts）を正とし、ここはそれに手で
/// 対応させる。対応は、契約の見本（packages/contracts/src/fixtures/messages.json）を
/// decode → encode して元と一致することで、テストで守る（protocol/json_test.gleam）。
///
/// ID は電文の形（文字列）のまま持ち、ルームの内部型には依存しない。ゲーム固有の
/// payload と、ルーム作成時の settings は Dynamic のまま運び、意味づけと検証は
/// ゲームに委ねる（境界での unknown 検証）。
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/json.{type Json}
import gleam/list
import gleam/option.{type Option, None, Some}

// --- 型 ------------------------------------------------------------------

/// JSON の数値。整数と小数を区別して、往復しても形が変わらないようにする。
pub type Number {
  IntNumber(Int)
  FloatNumber(Float)
}

/// ルーム一覧での状態。waiting は今参加できる、playing は参加できない。
pub type RoomStatus {
  Waiting
  Playing
}

pub type RoomSummary {
  RoomSummary(
    room_id: String,
    game_type: String,
    player_count: Int,
    capacity: Int,
    status: RoomStatus,
  )
}

pub type PlayerInfo {
  PlayerInfo(player_id: String, name: String)
}

/// 結果の補助指標の値（文字列か数値）。
pub type Detail {
  DetailText(String)
  DetailNumber(Number)
}

pub type PlayResult {
  PlayResult(score: Number, details: Option(List(#(String, Detail))))
}

pub type ScoreOrder {
  HigherIsBetter
  LowerIsBetter
}

pub type RankingEntry {
  RankingEntry(player_id: String, name: String, rank: Int, result: PlayResult)
}

pub type RealtimeResult {
  RealtimeResult(order: ScoreOrder, rankings: List(RankingEntry))
}

/// クライアント → サーバー。
pub type ClientMessage {
  SetName(player_id: String, name: String)
  ListRooms(game_type: String)
  /// settings はマニフェストの roomOptions で選んだ値。検証はゲームが行う。
  CreateRoom(game_type: String, settings: Option(Dynamic))
  JoinRoom(game_type: String, room_id: String)
  LeaveRoom(room_id: String)
  /// 再接続猶予のうちに同じプレイヤーとして復帰する。resume_token は本人にだけ届いた秘密の値。
  Reconnect(room_id: String, resume_token: String)
  GameEvent(game_type: String, room_id: String, payload: Dynamic)
  /// ハートビートの応答（issue-41 / ADR 0041）。接続の層だけで扱う。
  Pong
}

/// サーバー → クライアント。
pub type ServerMessage {
  RoomList(game_type: String, rooms: List(RoomSummary))
  RoomJoined(
    game_type: String,
    room_id: String,
    you: String,
    players: List(PlayerInfo),
  )
  PlayerJoined(room_id: String, player: PlayerInfo)
  PlayerLeft(room_id: String, player_id: String)
  GameStarted(game_type: String, room_id: String)
  /// ルームの全員に同じ内容を送る状態配信（contracts: "game-state"）。
  GameState(game_type: String, room_id: String, payload: Dynamic)
  /// 特定のプレイヤーだけに宛てた状態配信（contracts: "game-state-to" / ADR 0021）。
  /// 宛先の接続にだけ送る。to は受け取る本人の ID。
  GameStateTo(game_type: String, room_id: String, to: String, payload: Dynamic)
  GameEnded(game_type: String, room_id: String, result: RealtimeResult)
  ErrorMessage(code: String, message: String)
  /// 接続直後に本人にだけ送る。resume_token は再接続の復帰キーで、本人以外に送らない。
  Session(player_id: String, resume_token: String)
  /// ハートビート（issue-41 / ADR 0041）。固定の間隔で全接続に送る。接続の層だけで扱う。
  Ping
}

/// 契約の ClientMessage の type 一覧（contracts の CLIENT_MESSAGE_TYPES と一致させる）。
pub const client_message_types = [
  "set-name", "list-rooms", "create-room", "join-room", "leave-room",
  "reconnect", "game-event", "pong",
]

/// 契約の ServerMessage の type 一覧（contracts の SERVER_MESSAGE_TYPES と一致させる）。
pub const server_message_types = [
  "room-list", "room-joined", "player-joined", "player-left", "game-started",
  "game-state", "game-state-to", "game-ended", "error", "session", "ping",
]

/// 電文の type。contracts の ServerMessage の type と一致させる。
pub fn type_name(message: ServerMessage) -> String {
  case message {
    RoomList(..) -> "room-list"
    RoomJoined(..) -> "room-joined"
    PlayerJoined(..) -> "player-joined"
    PlayerLeft(..) -> "player-left"
    GameStarted(..) -> "game-started"
    GameState(..) -> "game-state"
    GameStateTo(..) -> "game-state-to"
    GameEnded(..) -> "game-ended"
    ErrorMessage(..) -> "error"
    Session(..) -> "session"
    Ping -> "ping"
  }
}

// --- encode ----------------------------------------------------------------

pub fn encode_server(message: ServerMessage) -> String {
  server_json(message) |> json.to_string
}

pub fn encode_client(message: ClientMessage) -> String {
  client_json(message) |> json.to_string
}

fn typed(kind: String, fields: List(#(String, Json))) -> Json {
  json.object([#("type", json.string(kind)), ..fields])
}

fn server_json(message: ServerMessage) -> Json {
  let kind = type_name(message)
  case message {
    RoomList(game_type, rooms) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("rooms", json.array(rooms, room_summary_json)),
      ])
    RoomJoined(game_type, room_id, you, players) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
        #("you", json.string(you)),
        #("players", json.array(players, player_info_json)),
      ])
    PlayerJoined(room_id, player) ->
      typed(kind, [
        #("roomId", json.string(room_id)),
        #("player", player_info_json(player)),
      ])
    PlayerLeft(room_id, player_id) ->
      typed(kind, [
        #("roomId", json.string(room_id)),
        #("playerId", json.string(player_id)),
      ])
    GameStarted(game_type, room_id) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
      ])
    GameState(game_type, room_id, payload) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
        #("payload", json_of_dynamic(payload)),
      ])
    GameStateTo(game_type, room_id, to, payload) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
        #("to", json.string(to)),
        #("payload", json_of_dynamic(payload)),
      ])
    GameEnded(game_type, room_id, result) ->
      typed(kind, [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
        #("result", realtime_result_json(result)),
      ])
    ErrorMessage(code, text) ->
      typed(kind, [
        #("code", json.string(code)),
        #("message", json.string(text)),
      ])
    Session(player_id, resume_token) ->
      typed(kind, [
        #("playerId", json.string(player_id)),
        #("resumeToken", json.string(resume_token)),
      ])
    Ping -> typed(kind, [])
  }
}

fn client_json(message: ClientMessage) -> Json {
  case message {
    SetName(player_id, name) ->
      typed("set-name", [
        #("playerId", json.string(player_id)),
        #("name", json.string(name)),
      ])
    ListRooms(game_type) ->
      typed("list-rooms", [#("gameType", json.string(game_type))])
    CreateRoom(game_type, settings) ->
      typed(
        "create-room",
        list.flatten([
          [#("gameType", json.string(game_type))],
          case settings {
            Some(value) -> [#("settings", json_of_dynamic(value))]
            None -> []
          },
        ]),
      )
    JoinRoom(game_type, room_id) ->
      typed("join-room", [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
      ])
    LeaveRoom(room_id) ->
      typed("leave-room", [#("roomId", json.string(room_id))])
    Reconnect(room_id, resume_token) ->
      typed("reconnect", [
        #("roomId", json.string(room_id)),
        #("resumeToken", json.string(resume_token)),
      ])
    GameEvent(game_type, room_id, payload) ->
      typed("game-event", [
        #("gameType", json.string(game_type)),
        #("roomId", json.string(room_id)),
        #("payload", json_of_dynamic(payload)),
      ])
    Pong -> typed("pong", [])
  }
}

fn room_summary_json(room: RoomSummary) -> Json {
  json.object([
    #("roomId", json.string(room.room_id)),
    #("gameType", json.string(room.game_type)),
    #("playerCount", json.int(room.player_count)),
    #("capacity", json.int(room.capacity)),
    #(
      "status",
      json.string(case room.status {
        Waiting -> "waiting"
        Playing -> "playing"
      }),
    ),
  ])
}

fn player_info_json(player: PlayerInfo) -> Json {
  json.object([
    #("playerId", json.string(player.player_id)),
    #("name", json.string(player.name)),
  ])
}

fn number_json(number: Number) -> Json {
  case number {
    IntNumber(value) -> json.int(value)
    FloatNumber(value) -> json.float(value)
  }
}

fn play_result_json(result: PlayResult) -> Json {
  json.object(
    list.flatten([
      [#("score", number_json(result.score))],
      case result.details {
        Some(details) -> [
          #(
            "details",
            json.object(
              list.map(details, fn(entry) {
                let #(key, value) = entry
                #(key, case value {
                  DetailText(text) -> json.string(text)
                  DetailNumber(number) -> number_json(number)
                })
              }),
            ),
          ),
        ]
        None -> []
      },
    ]),
  )
}

fn realtime_result_json(result: RealtimeResult) -> Json {
  json.object([
    #(
      "order",
      json.string(case result.order {
        HigherIsBetter -> "higher-is-better"
        LowerIsBetter -> "lower-is-better"
      }),
    ),
    #(
      "rankings",
      json.array(result.rankings, fn(entry) {
        json.object([
          #("playerId", json.string(entry.player_id)),
          #("name", json.string(entry.name)),
          #("rank", json.int(entry.rank)),
          #("result", play_result_json(entry.result)),
        ])
      }),
    ),
  ])
}

/// ゲーム固有の値（Dynamic）を JSON にする。Gleam の nil と JSON の null は null に、
/// 真偽値・整数・小数・文字列・リスト・文字列キーの辞書はそのまま写す。それ以外は null。
pub fn json_of_dynamic(value: Dynamic) -> Json {
  let null = decode.optional(decode.failure(Nil, "null"))
  case decode.run(value, null) {
    Ok(None) -> json.null()
    _ ->
      case decode.run(value, decode.bool) {
        Ok(flag) -> json.bool(flag)
        Error(_) ->
          case decode.run(value, decode.int) {
            Ok(number) -> json.int(number)
            Error(_) ->
              case decode.run(value, decode.float) {
                Ok(number) -> json.float(number)
                Error(_) ->
                  case decode.run(value, decode.string) {
                    Ok(text) -> json.string(text)
                    Error(_) -> composite_json(value)
                  }
              }
          }
      }
  }
}

fn composite_json(value: Dynamic) -> Json {
  case decode.run(value, decode.list(decode.dynamic)) {
    Ok(items) -> json.preprocessed_array(list.map(items, json_of_dynamic))
    Error(_) ->
      case decode.run(value, decode.dict(decode.string, decode.dynamic)) {
        Ok(entries) ->
          entries
          |> dict.to_list
          |> list.map(fn(entry) { #(entry.0, json_of_dynamic(entry.1)) })
          |> json.object
        Error(_) -> json.null()
      }
  }
}

// --- decode ----------------------------------------------------------------

pub fn decode_client(text: String) -> Result(ClientMessage, json.DecodeError) {
  json.parse(text, client_decoder())
}

pub fn decode_server(text: String) -> Result(ServerMessage, json.DecodeError) {
  json.parse(text, server_decoder())
}

fn client_decoder() -> Decoder(ClientMessage) {
  use kind <- decode.field("type", decode.string)
  case kind {
    "set-name" -> {
      use player_id <- decode.field("playerId", decode.string)
      use name <- decode.field("name", decode.string)
      decode.success(SetName(player_id:, name:))
    }
    "list-rooms" -> {
      use game_type <- decode.field("gameType", decode.string)
      decode.success(ListRooms(game_type:))
    }
    "create-room" -> {
      use game_type <- decode.field("gameType", decode.string)
      use settings <- decode.optional_field(
        "settings",
        None,
        decode.map(decode.dynamic, Some),
      )
      decode.success(CreateRoom(game_type:, settings:))
    }
    "join-room" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      decode.success(JoinRoom(game_type:, room_id:))
    }
    "leave-room" -> {
      use room_id <- decode.field("roomId", decode.string)
      decode.success(LeaveRoom(room_id:))
    }
    "reconnect" -> {
      use room_id <- decode.field("roomId", decode.string)
      use resume_token <- decode.field("resumeToken", decode.string)
      decode.success(Reconnect(room_id:, resume_token:))
    }
    "game-event" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      use payload <- decode.field("payload", decode.dynamic)
      decode.success(GameEvent(game_type:, room_id:, payload:))
    }
    "pong" -> decode.success(Pong)
    _ -> decode.failure(ListRooms(""), "ClientMessage")
  }
}

fn server_decoder() -> Decoder(ServerMessage) {
  use kind <- decode.field("type", decode.string)
  case kind {
    "room-list" -> {
      use game_type <- decode.field("gameType", decode.string)
      use rooms <- decode.field("rooms", decode.list(room_summary_decoder()))
      decode.success(RoomList(game_type:, rooms:))
    }
    "room-joined" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      use you <- decode.field("you", decode.string)
      use players <- decode.field("players", decode.list(player_info_decoder()))
      decode.success(RoomJoined(game_type:, room_id:, you:, players:))
    }
    "player-joined" -> {
      use room_id <- decode.field("roomId", decode.string)
      use player <- decode.field("player", player_info_decoder())
      decode.success(PlayerJoined(room_id:, player:))
    }
    "player-left" -> {
      use room_id <- decode.field("roomId", decode.string)
      use player_id <- decode.field("playerId", decode.string)
      decode.success(PlayerLeft(room_id:, player_id:))
    }
    "game-started" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      decode.success(GameStarted(game_type:, room_id:))
    }
    "game-state" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      use payload <- decode.field("payload", decode.dynamic)
      decode.success(GameState(game_type:, room_id:, payload:))
    }
    "game-state-to" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      use to <- decode.field("to", decode.string)
      use payload <- decode.field("payload", decode.dynamic)
      decode.success(GameStateTo(game_type:, room_id:, to:, payload:))
    }
    "game-ended" -> {
      use game_type <- decode.field("gameType", decode.string)
      use room_id <- decode.field("roomId", decode.string)
      use result <- decode.field("result", realtime_result_decoder())
      decode.success(GameEnded(game_type:, room_id:, result:))
    }
    "error" -> {
      use code <- decode.field("code", decode.string)
      use text <- decode.field("message", decode.string)
      decode.success(ErrorMessage(code:, message: text))
    }
    "session" -> {
      use player_id <- decode.field("playerId", decode.string)
      use resume_token <- decode.field("resumeToken", decode.string)
      decode.success(Session(player_id:, resume_token:))
    }
    "ping" -> decode.success(Ping)
    _ -> decode.failure(ErrorMessage("", ""), "ServerMessage")
  }
}

fn room_summary_decoder() -> Decoder(RoomSummary) {
  use room_id <- decode.field("roomId", decode.string)
  use game_type <- decode.field("gameType", decode.string)
  use player_count <- decode.field("playerCount", decode.int)
  use capacity <- decode.field("capacity", decode.int)
  use status <- decode.field("status", room_status_decoder())
  decode.success(RoomSummary(
    room_id:,
    game_type:,
    player_count:,
    capacity:,
    status:,
  ))
}

fn room_status_decoder() -> Decoder(RoomStatus) {
  use text <- decode.then(decode.string)
  case text {
    "waiting" -> decode.success(Waiting)
    "playing" -> decode.success(Playing)
    _ -> decode.failure(Waiting, "RoomStatus")
  }
}

fn player_info_decoder() -> Decoder(PlayerInfo) {
  use player_id <- decode.field("playerId", decode.string)
  use name <- decode.field("name", decode.string)
  decode.success(PlayerInfo(player_id:, name:))
}

fn number_decoder() -> Decoder(Number) {
  decode.one_of(decode.map(decode.int, IntNumber), [
    decode.map(decode.float, FloatNumber),
  ])
}

fn play_result_decoder() -> Decoder(PlayResult) {
  use score <- decode.field("score", number_decoder())
  use details <- decode.optional_field(
    "details",
    None,
    decode.map(
      decode.dict(
        decode.string,
        decode.one_of(decode.map(decode.string, DetailText), [
          decode.map(number_decoder(), DetailNumber),
        ]),
      ),
      fn(entries) { Some(dict.to_list(entries)) },
    ),
  )
  decode.success(PlayResult(score:, details:))
}

fn realtime_result_decoder() -> Decoder(RealtimeResult) {
  use order <- decode.field("order", {
    use text <- decode.then(decode.string)
    case text {
      "higher-is-better" -> decode.success(HigherIsBetter)
      "lower-is-better" -> decode.success(LowerIsBetter)
      _ -> decode.failure(LowerIsBetter, "ScoreOrder")
    }
  })
  use rankings <- decode.field(
    "rankings",
    decode.list({
      use player_id <- decode.field("playerId", decode.string)
      use name <- decode.field("name", decode.string)
      use rank <- decode.field("rank", decode.int)
      use result <- decode.field("result", play_result_decoder())
      decode.success(RankingEntry(player_id:, name:, rank:, result:))
    }),
  )
  decode.success(RealtimeResult(order:, rankings:))
}
