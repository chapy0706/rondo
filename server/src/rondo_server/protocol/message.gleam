/// サーバー -> クライアント メッセージ（電文）の Gleam 側の型。
///
/// 契約は TypeScript（packages/contracts/src/messages.ts の ServerMessage）を正とし、
/// ここはそれに手で対応させる（ADR 0009）。現時点ではゲーム状態の配信に使う 2 種だけを
/// 持つ。ID は電文の形（文字列）のまま持ち、ルームの内部型には依存しない。
/// payload はゲーム固有のため Dynamic とし、意味づけはゲームに委ねる。
/// JSON への符号化は、実接続をルームに繋ぐときに足す。
import gleam/dynamic.{type Dynamic}

pub type ServerMessage {
  /// ルームの全員に同じ内容を送る状態配信（contracts: "game-state"）。
  GameState(game_type: String, room_id: String, payload: Dynamic)
  /// 特定のプレイヤーだけに宛てた状態配信（contracts: "game-state-to" / ADR 0021）。
  /// 宛先の接続にだけ送る。to は受け取る本人の ID。
  GameStateTo(game_type: String, room_id: String, to: String, payload: Dynamic)
}

/// 電文の type。contracts の ServerMessage の type と一致させる。
pub fn type_name(message: ServerMessage) -> String {
  case message {
    GameState(..) -> "game-state"
    GameStateTo(..) -> "game-state-to"
  }
}
