/// ゲーム種別ごとのルームの作り方（issue-31）。
///
/// 実接続の入口（connection/session）が、create-room の gameType からルームの設定
/// （RoomSpec）と開始の仕方を引くための表。各ゲームのロジックには触れず、既にある
/// 組み立て関数（veryare.spec、tilt_maze.create）を呼ぶだけにする。
import gleam/dict.{type Dict}
import gleam/dynamic.{type Dynamic}
import gleam/option.{type Option, None, Some}
import rondo_server/games/tilt_maze/authority as tilt_maze
import rondo_server/games/veryare/room as veryare
import rondo_server/room/room_actor.{type RoomId, type RoomSpec, RoomSpec}

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
pub fn spec_for(
  game_type: String,
  id: RoomId,
  settings: Option(Dynamic),
) -> Result(#(RoomSpec, StartPolicy), CatalogError) {
  case game_type {
    "veryare" ->
      case veryare.parse_settings(settings) {
        Ok(parsed) -> Ok(#(veryare.spec(id, parsed), StartOnCreate))
        Error(Nil) -> Error(InvalidSettings)
      }
    "tilt-maze" ->
      Ok(#(
        RoomSpec(
          id:,
          game_type: "tilt-maze",
          min_players: 2,
          max_players: 4,
          authority: Some(tilt_maze.create),
          driver: None,
          member_info: None,
        ),
        StartAtMinimum,
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
