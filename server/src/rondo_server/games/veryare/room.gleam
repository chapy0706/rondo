/// veryare をルームに載せる（ADR 0024 / 0030）。
///
/// 純粋な状態機械（games/veryare/game）を、ルームの差し込み口（room/driver）に包む。
/// ルームは veryare を知らず、ここが返す RoomSpec と箱を動かすだけである。
/// タイマーは各フェーズの長さで張り、フェーズの通し番号（step）を token にして、
/// 早く終わったフェーズの古いタイマーを状態機械の側で無視する。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import rondo_server/games/veryare/game.{
  type Game, type Outcome, type Phase, Ended, Exploration, HidersWin,
  NotEnoughPlayers, OniSelection, OniWins, Painting, Preparation,
}
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{
  type PlayerId, type RoomId, type RoomSpec, PlayerId, RoomSpec,
}

/// ゲーム種別。マニフェストの id と一致させる（ADR 0023）。
pub const game_type = "veryare"

/// 最小人数（鬼1 + 隠れ側1 / ADR 0030）。
pub const min_players = 2

/// 定員（鬼1 + 隠れ側4 / ADR 0030）。
pub const max_players = 5

/// 同時にアクティブにできるルーム数（ADR 0030）。ルーム台帳に渡す。
pub const max_active_rooms = 3

/// 探索フェーズの長さの選択肢（秒）。20秒刻み、基本40秒（ADR 0024）。
pub const exploration_choices = [40, 60, 80, 100, 120]

/// 探索フェーズの長さの基本値（秒）。
pub const default_exploration_seconds = 40

/// ルーム作成時の設定。
pub type Settings {
  Settings(exploration_seconds: Int)
}

/// create-room の settings（unknown）を検証する。省略時は基本値。
/// 選択肢にない値は拒否する（境界での unknown 検証）。
pub fn parse_settings(raw: Option(Dynamic)) -> Result(Settings, Nil) {
  case raw {
    None -> Ok(Settings(default_exploration_seconds))
    Some(data) -> {
      let decoder = {
        use seconds <- decode.optional_field(
          "explorationSeconds",
          default_exploration_seconds,
          decode.int,
        )
        decode.success(seconds)
      }
      case decode.run(data, decoder) {
        Ok(seconds) ->
          case list.contains(exploration_choices, seconds) {
            True -> Ok(Settings(seconds))
            False -> Error(Nil)
          }
        Error(_) -> Error(Nil)
      }
    }
  }
}

/// 本番のルーム設定。フェーズの長さは ADR 0024 の値、鬼選出の乱数は int.random。
pub fn spec(id: RoomId, settings: Settings) -> RoomSpec {
  spec_with(
    id,
    settings,
    game.durations(exploration_ms: settings.exploration_seconds * 1000),
    int.random,
  )
}

/// フェーズの長さと乱数を差し替えられるルーム設定（テスト用）。
pub fn spec_with(
  id: RoomId,
  settings: Settings,
  durations: game.Durations,
  pick: fn(Int) -> Int,
) -> RoomSpec {
  RoomSpec(
    id:,
    game_type:,
    min_players:,
    max_players:,
    authority: None,
    driver: Some(fn(players) { start(players, durations, pick) }),
    member_info: Some(room_info(settings)),
  )
}

// --- 箱 ------------------------------------------------------------------

fn start(
  players: List(PlayerId),
  durations: game.Durations,
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let initial = game.new(players, durations)
  #(wrap(initial, pick), phase_effects(initial))
}

fn wrap(state: Game(PlayerId), pick: fn(Int) -> Int) -> Driver(PlayerId) {
  driver.new(
    on_event: fn(player, payload) {
      case decode.run(payload, move_decoder()) {
        Ok(#(x, z)) -> step(state, game.move(state, player, x, z), pick)
        Error(_) -> #(wrap(state, pick), [])
      }
    },
    on_leave: fn(player) { step(state, game.leave(state, player), pick) },
    on_wake: fn(token) { step(state, game.advance(state, token, pick), pick) },
    is_over: fn() {
      case state.phase {
        Ended(_) -> True
        _ -> False
      }
    },
  )
}

/// フェーズが変わったときだけ、全員へ通知し、次のタイマーを張る。
fn step(
  before: Game(PlayerId),
  after: Game(PlayerId),
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let effects = case after.step == before.step {
    True -> []
    False -> phase_effects(after)
  }
  #(wrap(after, pick), effects)
}

fn phase_effects(state: Game(PlayerId)) -> List(Effect(PlayerId)) {
  let notice = driver.Broadcast(phase_payload(state))
  case game.phase_duration(state) {
    Some(ms) -> [notice, driver.WakeAfter(ms, state.step)]
    None -> [notice]
  }
}

// --- 電文 ----------------------------------------------------------------

/// 移動の報告 { type: "move", x, z }。数値は整数でも受け付ける。
fn move_decoder() -> decode.Decoder(#(Float, Float)) {
  use kind <- decode.field("type", decode.string)
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  case kind {
    "move" -> decode.success(#(x, z))
    _ -> decode.failure(#(0.0, 0.0), "move")
  }
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.int |> decode.map(int.to_float)])
}

/// 入室後の案内。探索時間はルーム一覧には出さず、ここで初めて伝える。
fn room_info(settings: Settings) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("room-info")),
    #(
      dynamic.string("explorationSeconds"),
      dynamic.int(settings.exploration_seconds),
    ),
  ])
}

/// フェーズの通知。全員に同じ内容を送るため、隠れ側の位置は載せない。
fn phase_payload(state: Game(PlayerId)) -> Dynamic {
  let oni = case state.oni {
    Some(PlayerId(id)) -> dynamic.string(id)
    None -> dynamic.nil()
  }
  let duration = case game.phase_duration(state) {
    Some(ms) -> dynamic.int(ms)
    None -> dynamic.nil()
  }
  let outcome = case state.phase {
    Ended(result) -> dynamic.string(outcome_name(result))
    _ -> dynamic.nil()
  }
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("phase")),
    #(dynamic.string("phase"), dynamic.string(phase_name(state.phase))),
    #(dynamic.string("durationMs"), duration),
    #(dynamic.string("oni"), oni),
    #(dynamic.string("outcome"), outcome),
  ])
}

fn phase_name(phase: Phase) -> String {
  case phase {
    OniSelection -> "oni-selection"
    Preparation -> "preparation"
    Painting -> "painting"
    Exploration -> "exploration"
    Ended(_) -> "ended"
  }
}

fn outcome_name(outcome: Outcome) -> String {
  case outcome {
    OniWins -> "oni-wins"
    HidersWin -> "hiders-win"
    NotEnoughPlayers -> "not-enough-players"
  }
}
