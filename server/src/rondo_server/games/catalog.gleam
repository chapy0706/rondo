/// ゲーム種別ごとのルームの作り方（issue-31）。
///
/// 実接続の入口（connection/session）が、create-room の gameType からルームの設定
/// （RoomSpec）と開始の仕方を引くための表。各ゲームのロジックには触れず、既にある
/// 組み立て関数（veryare.spec、tilt_maze.create）を呼ぶだけにする。
import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/option.{type Option, None, Some}
import rondo_server/games/tilt_maze/authority as tilt_maze
import rondo_server/games/timing.{type Timing}
import rondo_server/games/veryare/room as veryare
import rondo_server/room/room_actor.{
  type RoomId, type RoomKind, type RoomSpec, Match, RoomSpec, Spectate,
}

/// ゲームをいつ始めるか（契約に開始の電文は無く、サーバーが自動で始める）。
pub type StartPolicy {
  /// 作成した直後に始める。veryare は待機ルーム（鬼選出）から始まり、途中参加できる。
  StartOnCreate
  /// 参加で最小人数に達した時点で始める（Tilt Maze）。
  StartAtMinimum
}

pub type CatalogError {
  UnknownGame
  InvalidSettings
}

/// ゲーム種別ごとの同時ルーム数の上限（room_directory に渡す）。
pub fn room_limits() -> Dict(String, Int) {
  dict.from_list([#(veryare.game_type, veryare.max_active_rooms)])
}

/// ルームの設定と開始の仕方。settings は create-room の settings（未検証）。
/// timing はテスト用のフェーズ時間の短縮（issue-49）。本番は Normal。観戦ルームの設定（spectate: 1）
/// でも、設定と開始の仕方だけを返す（種類は room_for）。
pub fn spec_for(
  game_type: String,
  id: RoomId,
  settings: Option(Dynamic),
  timing: Timing,
) -> Result(#(RoomSpec, StartPolicy), CatalogError) {
  case room_for(game_type, id, settings, timing) {
    Ok(#(spec, policy, _kind)) -> Ok(#(spec, policy))
    Error(error) -> Error(error)
  }
}

/// ルームの設定と開始の仕方と、種類（対戦・観戦 / issue-67）。作成の入口（connection/session）が使う。
/// 観戦ルーム（veryare の spectate: 1）は、旗（veryare.spectate_ready）か、開発用の環境変数
/// RONDO_SPECTATE_DEV=1 のときだけ受け付ける。それ以外は InvalidSettings。
pub fn room_for(
  game_type: String,
  id: RoomId,
  settings: Option(Dynamic),
  timing: Timing,
) -> Result(#(RoomSpec, StartPolicy, RoomKind), CatalogError) {
  case game_type {
    "veryare" ->
      case veryare.parse_spectate_room(settings) {
        Ok(Some(spectating)) ->
          Ok(#(
            veryare.spectate_spec_on(id, spectating, timing),
            StartOnCreate,
            Spectate(veryare.spectate_config(timing)),
          ))
        Error(Nil) -> Error(InvalidSettings)
        Ok(None) ->
          case veryare.parse_room(settings), veryare.parse_rules(settings) {
            Ok(#(parsed, stage)), Ok(rules) ->
              Ok(#(
                veryare.spec_ruled(id, parsed, stage, rules, timing),
                StartOnCreate,
                Match,
              ))
            _, _ -> Error(InvalidSettings)
          }
      }
    "tilt-maze" ->
      Ok(#(
        RoomSpec(
          id:,
          game_type: "tilt-maze",
          name: "",
          min_players: 2,
          max_players: 4,
          authority: Some(tilt_maze.create),
          driver: None,
          member_info: None,
          bots: [],
          // 結果のあと、ルームを閉じるまでの時間（issue-70）。
          close_after_ms: timing.finished_close_ms(timing),
        ),
        StartAtMinimum,
        Match,
      ))
    _ -> Error(UnknownGame)
  }
}

/// 既にあるルームの開始の仕方（参加時に使う）。
pub fn start_policy(game_type: String) -> StartPolicy {
  case game_type {
    "veryare" -> StartOnCreate
    _ -> StartAtMinimum
  }
}
