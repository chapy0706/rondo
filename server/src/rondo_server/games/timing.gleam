/// テスト用のフェーズ時間の短縮（issue-49）。
///
/// ボット同士の対戦（`make bots`）で、ゲームの最初から最後までを数秒で通すために、
/// 環境変数 RONDO_TEST_PHASE_DIVISOR で、veryare のフェーズ時間を割る。
/// 環境変数が無い・正しくない値なら短縮しない（本番の既定は変えない）。
/// 時間は状態機械（game）の外のタイマーにだけ効くので、フェーズの順序と勝敗は変わらない。
/// 再接続猶予（ADR 0013）とハートビート（issue-41）の時間は、ここでは縮めない。
import gleam/int
import gleam/string
import rondo_server/games/veryare/game.{type Durations, Durations}

/// 環境変数の名前。
pub const env_name = "RONDO_TEST_PHASE_DIVISOR"

/// 割る数の上限。これより大きい値は、取り違えとみなして短縮しない。
const max_divisor = 1000

pub type Timing {
  /// 本番の時間のまま。
  Normal
  /// 全フェーズの時間を divisor で割る。
  Faster(divisor: Int)
}

/// 環境変数の値（無ければ Error）から決める。2 以上 1000 以下の整数のときだけ短縮する。
pub fn from_env(value: Result(String, Nil)) -> Timing {
  case value {
    Ok(raw) ->
      case int.parse(string.trim(raw)) {
        Ok(divisor) if divisor >= 2 && divisor <= max_divisor ->
          Faster(divisor:)
        _ -> Normal
      }
    Error(Nil) -> Normal
  }
}

/// フェーズ時間に当てはめる。どのフェーズも 1 ミリ秒より短くはしない。
pub fn apply(durations: Durations, timing: Timing) -> Durations {
  case timing {
    Normal -> durations
    Faster(divisor) -> {
      let scale = fn(ms: Int) { int.max(1, ms / divisor) }
      Durations(
        oni_selection_ms: scale(durations.oni_selection_ms),
        preparation_ms: scale(durations.preparation_ms),
        painting_ms: scale(durations.painting_ms),
        exploration_ms: scale(durations.exploration_ms),
        reveal_ms: scale(durations.reveal_ms),
      )
    }
  }
}
