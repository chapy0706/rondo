import gleam/erlang/process
import gleeunit/should
import rondo_server/connection/connection_actor.{
  AwaitingReconnect, Connected, ConnectionId,
}

// テスト用の短い猶予。実際の発火を観測するため小さくする。
const test_grace_ms = 30

/// 接続ごとに接続アクターが立ち、初期状態は Connected。
pub fn starts_connected_test() {
  let assert Ok(started) =
    connection_actor.start(ConnectionId("c1"), test_grace_ms)

  process.is_alive(started.pid)
  |> should.be_true

  connection_actor.status(started.data)
  |> should.equal(Connected)
}

/// 切断すると再接続猶予の待機状態に移る（タイマー起動）。
pub fn disconnect_enters_grace_test() {
  let assert Ok(started) =
    connection_actor.start(ConnectionId("c2"), test_grace_ms)

  connection_actor.disconnect(started.data)

  connection_actor.status(started.data)
  |> should.equal(AwaitingReconnect)
}

/// 猶予内に再接続すればタイマーが解除され、接続を維持する。
pub fn reconnect_within_grace_keeps_alive_test() {
  let assert Ok(started) =
    connection_actor.start(ConnectionId("c3"), test_grace_ms)

  connection_actor.disconnect(started.data)
  connection_actor.reconnect(started.data)

  // 猶予を十分に超えて待っても、解除済みなので生存し続ける。
  process.sleep(test_grace_ms * 3)

  process.is_alive(started.pid)
  |> should.be_true

  connection_actor.status(started.data)
  |> should.equal(Connected)
}

/// 猶予を過ぎて再接続がなければ離脱が確定し、アクターは終了する。
pub fn grace_expiry_stops_actor_test() {
  let assert Ok(started) =
    connection_actor.start(ConnectionId("c4"), test_grace_ms)

  connection_actor.disconnect(started.data)

  // 猶予を超えて待つと、タイマー発火でプロセスが停止する。
  process.sleep(test_grace_ms * 3)

  process.is_alive(started.pid)
  |> should.be_false
}
