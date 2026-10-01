/// リアルタイムの WebSocket の受け口（issue-31 / ADR 0006・0007）。
///
/// ソケット1本につき1プロセス（mist の WebSocket プロセス）で、接続ごとの処理
/// （connection/session）を状態として持つ。1本の接続で、ロビー・ルーム・ゲームの電文を
/// すべて運ぶ（多重化）。
///
/// - 接続時に、本人へ session（プレイヤー識別子と復帰トークン）を送る
/// - テキストの電文を decode して session に渡し、返信を送る。形の違う電文は error を返す
/// - ルームからの配信は、この接続の送信先（outbox）に届くので、JSON にしてそのまま送る
/// - 切断したらルームから抜ける（再接続猶予は後半で実装する）
import gleam/erlang/process.{type Selector, type Subject}
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/list
import gleam/option.{Some}
import mist.{
  type Connection, type ResponseData, type WebsocketConnection,
  type WebsocketMessage, Binary, Closed, Custom, Shutdown, Text,
}
import rondo_server/connection/session.{type Deps, type Session}
import rondo_server/protocol/message.{type ServerMessage, ErrorMessage}

pub fn handle(req: Request(Connection), deps: Deps) -> Response(ResponseData) {
  mist.websocket(
    request: req,
    on_init: fn(conn) { on_init(conn, deps) },
    on_close: session.close,
    handler: fn(state, incoming, conn) { loop(state, incoming, conn, deps) },
  )
}

fn on_init(
  conn: WebsocketConnection,
  deps: Deps,
) -> #(Session, option.Option(Selector(ServerMessage))) {
  // 送信先はこのプロセスが持つ。ルームの配信は Custom として loop に届く。
  let outbox: Subject(ServerMessage) = process.new_subject()
  let selector = process.new_selector() |> process.select(outbox)
  let #(state, replies) = session.start(deps, outbox)
  send_all(conn, replies)
  #(state, Some(selector))
}

fn loop(
  state: Session,
  incoming: WebsocketMessage(ServerMessage),
  conn: WebsocketConnection,
  deps: Deps,
) -> mist.Next(Session, ServerMessage) {
  case incoming {
    Text(text) ->
      case message.decode_client(text) {
        Ok(parsed) -> {
          let #(state, replies) = session.handle(state, deps, parsed)
          send_all(conn, replies)
          mist.continue(state)
        }
        Error(_) -> {
          send_all(conn, [
            ErrorMessage("bad-message", "電文の形が正しくありません。"),
          ])
          mist.continue(state)
        }
      }
    // ルームからの配信（フェーズ通知・限定配信・参加の知らせ）をそのまま送る。
    Custom(outgoing) -> {
      send_all(conn, [outgoing])
      mist.continue(state)
    }
    // rondo はテキストフレームで多重化する。バイナリは想定しないので捨てる。
    Binary(_) -> mist.continue(state)
    Closed | Shutdown -> mist.stop()
  }
}

fn send_all(conn: WebsocketConnection, messages: List(ServerMessage)) -> Nil {
  list.each(messages, fn(outgoing) {
    let _ = mist.send_text_frame(conn, message.encode_server(outgoing))
    Nil
  })
}
