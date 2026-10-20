//// 終わったルームの自動閉鎖（issue-70 / ADR 0050）の、閉じる判断と通知の組み立て（純粋関数）。
////
//// 結果が確定してから閉じるまでの時間（既定 3 分）がたつと、ルーム（room_actor）は、残っている
//// 参加者へ error の room-expired を送ってから、ふつうに終わる。そのあとは、ルームが終わったときの
//// いまの仕組み（台帳から外す・接続から外す・切断中の接続は終わる / ADR 0045・0047）が働く。
//// 進行中のルームは閉じない（タイマーは、結果が確定したときだけ張る）。

import gleam/int
import rondo_server/protocol/message.{type ServerMessage, ErrorMessage}

/// 結果が確定してから、ルームを閉じるまでの時間（ミリ秒）。テスト用の短縮は games/timing の
/// finished_close_ms（RONDO_TEST_PHASE_DIVISOR で割る）。
pub const default_close_ms = 180_000

/// 閉じるタイマーの token（ルームの Wake）。ゲームのタイマー（veryare のフェーズ: 0 以上、鬼 CPU の
/// tick: -1 - step、待機メンバー: -1_000_000 - step）と重ならないよう、ずっと下に置く。
pub const expire_token = -1_000_000_000_000

/// token が、閉じるタイマーのものか。
pub fn is_expire_token(token: Int) -> Bool {
  token == expire_token
}

/// 閉じるまでの残り（ミリ秒）。結果が確定した時刻 finished_at + close_ms から、いま now を引く。
/// 過ぎていれば 0。時刻は、どれも同じ時計（単調な時計のミリ秒）。
pub fn remaining_ms(
  finished_at finished_at: Int,
  now now: Int,
  close_ms close_ms: Int,
) -> Int {
  int.max(0, finished_at + close_ms - now)
}

/// 閉じるときに、残っている参加者へ送る通知。code は room-expired（落ちたときの room-closed とは別。
/// 画面は code から文言を決め、ロビーへ戻す）。この文は、文言の表を持たない画面のための既定。
pub fn expired_notice() -> ServerMessage {
  ErrorMessage(code: "room-expired", message: "ゲームが終わってから時間がたったので、ルームを閉じました。")
}
