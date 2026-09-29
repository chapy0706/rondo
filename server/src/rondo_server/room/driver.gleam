/// ゲーム進行の差し込み口（ADR 0008 / 0024）。
///
/// 時間経過・離脱・プレイヤーごとの配信を伴うゲーム（veryare 等）を、ルームが中身を
/// 知らないまま動かすための箱。ルームはイベント・離脱・タイマーの満了を箱に渡し、
/// 箱は新しい箱と「指示」の一覧を返す。ルームは指示どおりに配信し、タイマーを張る。
/// 判定の中身は各ゲームが games/<id>/ に持つ。順位だけを扱う Authority とは別の口。
import gleam/dynamic.{type Dynamic}

/// ゲームからルームへの指示。
pub type Effect(id) {
  /// 購読中の全員に同じ内容を送る（game-state）。
  Broadcast(payload: Dynamic)
  /// 宛先のプレイヤーにだけ送る（game-state-to / ADR 0021）。宛先でない接続には送らない。
  Deliver(targets: List(id), payload: Dynamic)
  /// ms ミリ秒後に token を持ってゲームを起こす。token はゲームが古いタイマーを見分けるのに使う。
  WakeAfter(ms: Int, token: Int)
}

/// 箱。中身（ゲーム固有の状態）は閉じ、操作だけを公開する。
pub opaque type Driver(id) {
  Driver(
    on_event: fn(id, Dynamic) -> #(Driver(id), List(Effect(id))),
    on_leave: fn(id) -> #(Driver(id), List(Effect(id))),
    on_wake: fn(Int) -> #(Driver(id), List(Effect(id))),
    over: fn() -> Bool,
  )
}

/// 箱を組み立てる。ゲームは自分の状態を閉じ込めた関数を渡す。
pub fn new(
  on_event on_event: fn(id, Dynamic) -> #(Driver(id), List(Effect(id))),
  on_leave on_leave: fn(id) -> #(Driver(id), List(Effect(id))),
  on_wake on_wake: fn(Int) -> #(Driver(id), List(Effect(id))),
  is_over is_over: fn() -> Bool,
) -> Driver(id) {
  Driver(on_event:, on_leave:, on_wake:, over: is_over)
}

/// プレイヤーからのゲーム内イベント。
pub fn event(
  driver: Driver(id),
  player: id,
  payload: Dynamic,
) -> #(Driver(id), List(Effect(id))) {
  driver.on_event(player, payload)
}

/// 離脱の確定（再接続猶予を過ぎた切断 / ADR 0013）。
pub fn leave(
  driver: Driver(id),
  player: id,
) -> #(Driver(id), List(Effect(id))) {
  driver.on_leave(player)
}

/// WakeAfter で頼んだタイマーの満了。
pub fn wake(driver: Driver(id), token: Int) -> #(Driver(id), List(Effect(id))) {
  driver.on_wake(token)
}

/// ゲームが終わったか。
pub fn is_over(driver: Driver(id)) -> Bool {
  driver.over()
}
