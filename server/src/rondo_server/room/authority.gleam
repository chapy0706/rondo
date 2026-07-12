/// サーバー権威の箱（ADR 0008）。
///
/// 基盤はこの形だけを知り、判定の中身は各ゲームが与える。ルームはゲームの種類を
/// 知らないまま、受信したイベントを箱に流し、終了と結果だけを受け取る。
/// イベントのペイロードは unknown（Dynamic）とし、意味づけと検証はゲーム側が行う
/// （境界での unknown 検証 / ADR 0009）。順位はサーバー受信順で確定する（ADR 0014）。
import gleam/dynamic.{type Dynamic}

/// 1プレイヤー分の順位。rank は 1 始まり。
pub type Ranking(id) {
  Ranking(player: id, rank: Int)
}

/// ゲームの最終結果。順位はサーバーが受信した順で並ぶ（ADR 0014）。
pub type Outcome(id) {
  Outcome(rankings: List(Ranking(id)))
}

/// 権威の箱。中身（ゲーム固有の状態）は閉じ、操作だけを公開する。
/// record は 1 イベントを反映した新しい箱を返す（状態は不変に持ち回す）。
pub opaque type Authority(id) {
  Authority(
    on_event: fn(id, Dynamic) -> Authority(id),
    over: fn() -> Bool,
    result: fn() -> Outcome(id),
  )
}

/// 箱を組み立てる。ゲームは自分の状態を閉じ込めた 3 つの関数を渡す。
pub fn new(
  on_event on_event: fn(id, Dynamic) -> Authority(id),
  is_over is_over: fn() -> Bool,
  outcome outcome: fn() -> Outcome(id),
) -> Authority(id) {
  Authority(on_event:, over: is_over, result: outcome)
}

/// イベントを 1 件反映し、新しい箱を返す。
pub fn record(
  authority: Authority(id),
  player: id,
  payload: Dynamic,
) -> Authority(id) {
  authority.on_event(player, payload)
}

/// ゲームが終了したか。
pub fn is_over(authority: Authority(id)) -> Bool {
  authority.over()
}

/// 最終結果。is_over が True のときに意味を持つ。
pub fn outcome(authority: Authority(id)) -> Outcome(id) {
  authority.result()
}
