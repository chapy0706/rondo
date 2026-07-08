import gleeunit/should
import rondo_server/connection/connection_actor.{ConnectionId}
import rondo_server/connection/registry

const grace_ms = 10_000

/// 起動直後のレジストリは空。
pub fn starts_empty_test() {
  let assert Ok(reg) = registry.start()

  registry.count(reg.data)
  |> should.equal(0)
}

/// 登録した接続を ID で引ける。
pub fn register_and_lookup_test() {
  let assert Ok(reg) = registry.start()
  let assert Ok(conn) = connection_actor.start(ConnectionId("a"), grace_ms)

  registry.register(reg.data, ConnectionId("a"), conn.data)

  registry.count(reg.data)
  |> should.equal(1)

  let assert Ok(found) = registry.lookup(reg.data, ConnectionId("a"))
  // 引いた Subject が実際の接続アクターであることを状態問い合わせで確認する。
  connection_actor.status(found)
  |> should.equal(connection_actor.Connected)
}

/// 未登録の ID は Error(Nil) を返す。
pub fn lookup_unknown_test() {
  let assert Ok(reg) = registry.start()

  registry.lookup(reg.data, ConnectionId("missing"))
  |> should.equal(Error(Nil))
}

/// 解除すると引けなくなる。
pub fn unregister_removes_test() {
  let assert Ok(reg) = registry.start()
  let assert Ok(conn) = connection_actor.start(ConnectionId("b"), grace_ms)

  registry.register(reg.data, ConnectionId("b"), conn.data)
  registry.unregister(reg.data, ConnectionId("b"))

  registry.count(reg.data)
  |> should.equal(0)

  registry.lookup(reg.data, ConnectionId("b"))
  |> should.equal(Error(Nil))
}
