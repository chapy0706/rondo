import gleam/dict.{type Dict}
import gleam/erlang/process.{type Subject}
import gleam/otp/actor
import rondo_server/connection/connection_actor.{type ConnectionId}

/// 接続アクターへの Subject。レジストリが引いて返す値。
pub type Connection =
  Subject(connection_actor.Message)

/// レジストリが受け取るメッセージ。
///
/// 接続の登録・解除・参照を1プロセスに集約し、共有辞書の競合を避ける（ADR 0006）。
pub type Message {
  /// 接続アクターを登録する。
  Register(id: ConnectionId, connection: Connection)
  /// 登録を解除する。
  Unregister(id: ConnectionId)
  /// IDから接続アクターを引く。見つからなければ Error(Nil)。
  Lookup(id: ConnectionId, reply: Subject(Result(Connection, Nil)))
  /// 登録数を返す（監視・テスト用）。
  Count(reply: Subject(Int))
}

/// レジストリを起動する。プロセス起動時に1つ立て、Subject を全体で共有する。
pub fn start() -> Result(actor.Started(Subject(Message)), actor.StartError) {
  actor.new(dict.new())
  |> actor.on_message(handle)
  |> actor.start
}

/// 接続アクターを登録する。
pub fn register(
  registry: Subject(Message),
  id: ConnectionId,
  connection: Connection,
) -> Nil {
  process.send(registry, Register(id, connection))
}

/// 登録を解除する。
pub fn unregister(registry: Subject(Message), id: ConnectionId) -> Nil {
  process.send(registry, Unregister(id))
}

/// IDから接続アクターを引く。
pub fn lookup(
  registry: Subject(Message),
  id: ConnectionId,
) -> Result(Connection, Nil) {
  process.call(registry, 1000, Lookup(id, _))
}

/// 登録数を返す。
pub fn count(registry: Subject(Message)) -> Int {
  process.call(registry, 1000, Count)
}

fn handle(
  entries: Dict(ConnectionId, Connection),
  message: Message,
) -> actor.Next(Dict(ConnectionId, Connection), Message) {
  case message {
    Register(id, connection) ->
      actor.continue(dict.insert(entries, id, connection))

    Unregister(id) -> actor.continue(dict.delete(entries, id))

    Lookup(id, reply) -> {
      process.send(reply, dict.get(entries, id))
      actor.continue(entries)
    }

    Count(reply) -> {
      process.send(reply, dict.size(entries))
      actor.continue(entries)
    }
  }
}
