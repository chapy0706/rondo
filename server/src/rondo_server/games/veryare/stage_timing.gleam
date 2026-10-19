/// 骨格ごとのフェーズの長さ（issue-65 / ADR 0048）。純粋な関数。
///
/// - ふつう（10 種）: ルームの長さのまま（準備移動 20 秒、探索はルームで選んだ時間）
/// - 広い屋敷: 準備移動は骨格から計算した秒数（skeleton_check.preparation_seconds）。探索は、ルームで
///   選んだ時間に +80 秒。ペイントと答え合わせは変えない
///
/// 渡された長さ（テスト用の短縮 issue-49 を当てはめた後のもの）に合わせるため、秒数は、既定の準備移動
/// （game.preparation_ms = 20 秒）との比で、渡された準備移動の長さから作る。短縮が無ければ、ちょうど
/// 秒数 x 1000 ミリ秒になる（1/20 なら、20 秒 → 1 秒と同じ割合で縮む）。
import rondo_server/games/veryare/game.{type Durations, Durations}
import rondo_server/games/veryare/skeleton_check
import rondo_server/games/veryare/stage.{type Skeleton}

/// 広い屋敷で、探索の時間に足す秒数（issue-65 の決定 2）。
pub const wide_extra_exploration_seconds = 80

/// 骨格の準備移動の時間（秒）。ふつうは 20 秒のまま。
pub fn preparation_seconds(skeleton: Skeleton) -> Int {
  case stage.is_wide(skeleton) {
    True ->
      skeleton_check.preparation_seconds(skeleton_check.farthest_door(skeleton))
    False -> game.preparation_ms / 1000
  }
}

/// 骨格の探索の時間（秒）。ルームで選んだ時間（selected）に、広い屋敷なら +80 秒。
pub fn exploration_seconds(skeleton: Skeleton, selected: Int) -> Int {
  case stage.is_wide(skeleton) {
    True -> selected + wide_extra_exploration_seconds
    False -> selected
  }
}

/// 骨格に合わせたフェーズの長さ。ふつうは、渡された長さのまま（同じ値を返す）。
pub fn durations_for(durations: Durations, skeleton: Skeleton) -> Durations {
  case stage.is_wide(skeleton) {
    False -> durations
    True -> {
      let base = game.preparation_ms / 1000
      Durations(
        ..durations,
        preparation_ms: durations.preparation_ms
          * preparation_seconds(skeleton)
          / base,
        exploration_ms: durations.exploration_ms
          + durations.preparation_ms
          * wide_extra_exploration_seconds
          / base,
      )
    }
  }
}
