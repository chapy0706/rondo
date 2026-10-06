//// ハートビート（issue-41 / ADR 0041）。ソケット1本ごとに1つ動き、固定の間隔で ping を
//// 送り、クライアントからの電文が待ち時間のあいだ届かなければ、ソケットを閉じるよう頼む。
//// 時間は Config で差し替え、テストでは短くする。

import gleam/erlang/process.{type Subject}
import gleam/list
import gleeunit/should
import rondo_server/connection/heartbeat.{Alive, Config, Expired}
import rondo_server/protocol/message.{type ServerMessage, Ping}

fn start(
  interval_ms: Int,
  timeout_ms: Int,
) -> #(Subject(heartbeat.Message), Subject(ServerMessage), Subject(Nil)) {
  let outbox = process.new_subject()
  let timed_out = process.new_subject()
  let assert Ok(hb) =
    heartbeat.start(Config(interval_ms:, timeout_ms:), outbox, timed_out)
  #(hb, outbox, timed_out)
}

/// 届いたものを、待ち時間 ms のあいだ集める。
fn collect(outbox: Subject(a), ms: Int) -> List(a) {
  do_collect(outbox, ms, [])
}

fn do_collect(outbox: Subject(a), ms: Int, acc: List(a)) -> List(a) {
  case process.receive(outbox, ms) {
    Ok(m) -> do_collect(outbox, ms, [m, ..acc])
    Error(Nil) -> list.reverse(acc)
  }
}

// --- 待ち時間の判定（純粋な関数） ---------------------------------------------------

/// 最後に届いてから待ち時間に満たなければ、残りの時間をおいて確かめ直す。
pub fn check_is_alive_until_the_timeout_test() {
  heartbeat.check(last_seen: 1000, now: 1000, timeout_ms: 50)
  |> should.equal(Alive(recheck_in: 50))
  heartbeat.check(last_seen: 1000, now: 1030, timeout_ms: 50)
  |> should.equal(Alive(recheck_in: 20))
}

/// 待ち時間に達したら、接続を失ったとみなす。
pub fn check_expires_at_the_timeout_test() {
  heartbeat.check(last_seen: 1000, now: 1050, timeout_ms: 50)
  |> should.equal(Expired)
  heartbeat.check(last_seen: 1000, now: 9999, timeout_ms: 50)
  |> should.equal(Expired)
}

/// 既定は間隔 20 秒・待ち時間 50 秒（cloudflared の keepAliveTimeout 90 秒の半分以下）。
pub fn defaults_are_20_and_50_seconds_test() {
  heartbeat.default_config()
  |> should.equal(Config(interval_ms: 20_000, timeout_ms: 50_000))
}

// --- 送信と検知 ------------------------------------------------------------------

/// 設定した間隔で、ping を送り続ける。
pub fn pings_are_sent_at_the_interval_test() {
  let #(hb, outbox, _timed_out) = start(30, 10_000)
  let assert Ok(Ping) = process.receive(outbox, 200)
  let assert Ok(Ping) = process.receive(outbox, 200)
  let assert Ok(Ping) = process.receive(outbox, 200)
  heartbeat.stop(hb)
}

/// クライアントから何も届かなければ、待ち時間の後にソケットを閉じるよう頼み、止まる。
pub fn silence_asks_to_close_the_socket_test() {
  let #(hb, outbox, timed_out) = start(10_000, 60)
  let assert Ok(Nil) = process.receive(timed_out, 500)
  // 止まった後は、ping も検知も出ない。
  process.receive(timed_out, 100) |> should.equal(Error(Nil))
  process.receive(outbox, 0) |> should.equal(Error(Nil))
  process.is_alive(heartbeat.pid(hb)) |> should.be_false
}

/// 待ち時間より短い間隔で何か届いていれば、閉じない。ping は通信があっても固定の間隔で送る。
pub fn traffic_keeps_the_connection_and_pings_continue_test() {
  let #(hb, outbox, timed_out) = start(40, 100)
  list.each(list.repeat(Nil, 10), fn(_) {
    process.sleep(30)
    heartbeat.seen(hb)
  })
  process.receive(timed_out, 0) |> should.equal(Error(Nil))
  let pings = collect(outbox, 0)
  { list.length(pings) >= 5 } |> should.be_true
  list.all(pings, fn(m) { m == Ping }) |> should.be_true
  heartbeat.stop(hb)
}

/// 止めた後は、ping を送らず、閉じる頼みも出さない（ソケットが閉じたとき）。
pub fn stopped_heartbeat_sends_nothing_test() {
  let #(hb, outbox, timed_out) = start(30, 60)
  heartbeat.stop(hb)
  process.receive(outbox, 150) |> should.equal(Error(Nil))
  process.receive(timed_out, 0) |> should.equal(Error(Nil))
}
