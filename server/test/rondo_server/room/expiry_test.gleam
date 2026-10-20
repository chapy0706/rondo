//// 終わったルームの自動閉鎖（issue-70）の、閉じる判断と通知の組み立て（純粋関数）。

import gleeunit/should
import rondo_server/games/timing
import rondo_server/protocol/message
import rondo_server/room/expiry

/// 閉じるまでの時間は 3 分。テスト用の短縮（RONDO_TEST_PHASE_DIVISOR）で、フェーズ時間と同じく割る。
pub fn close_after_three_minutes_and_shortens_with_the_divisor_test() {
  expiry.default_close_ms |> should.equal(180_000)
  timing.finished_close_ms(timing.Normal) |> should.equal(180_000)
  timing.finished_close_ms(timing.Faster(20)) |> should.equal(9000)
  timing.finished_close_ms(timing.Faster(1000)) |> should.equal(180)
}

/// 残りは「結果が確定した時刻 + 閉じるまでの時間」から、いまを引いたもの。過ぎていれば 0。
pub fn remaining_counts_down_from_the_finish_test() {
  expiry.remaining_ms(finished_at: 5000, now: 5000, close_ms: 180_000)
  |> should.equal(180_000)
  expiry.remaining_ms(finished_at: 5000, now: 65_000, close_ms: 180_000)
  |> should.equal(120_000)
  expiry.remaining_ms(finished_at: 5000, now: 185_000, close_ms: 180_000)
  |> should.equal(0)
  expiry.remaining_ms(finished_at: 5000, now: 999_999, close_ms: 180_000)
  |> should.equal(0)
}

/// 閉じるタイマーの token は、ゲームのタイマーと重ならない（フェーズ: 0 以上、鬼 CPU の tick:
/// -1 - step、待機メンバー: -1_000_000 - step）。step が 10 億回を超えても重ならない。
pub fn expire_token_does_not_collide_with_game_timers_test() {
  { expiry.expire_token < 0 } |> should.be_true
  { expiry.expire_token < -1_000_000 - 1_000_000_000 } |> should.be_true
  expiry.is_expire_token(expiry.expire_token) |> should.be_true
  expiry.is_expire_token(0) |> should.be_false
  expiry.is_expire_token(-1) |> should.be_false
  expiry.is_expire_token(-1_000_000) |> should.be_false
}

/// 閉じるときの通知は error の room-expired（落ちたときの room-closed とは別）。
pub fn expired_notice_is_room_expired_test() {
  let assert message.ErrorMessage(code:, message: text) =
    expiry.expired_notice()
  code |> should.equal("room-expired")
  { text != "" } |> should.be_true
}
