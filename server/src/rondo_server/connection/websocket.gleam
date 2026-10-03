/// リアルタイムの WebSocket の受け口（issue-31 / ADR 0006・0007）。
///
/// ソケット1本につき1プロセス（mist の WebSocket プロセス）。プレイヤーの状態は接続
/// アクター（connection/session_actor）が持ち、ここは電文を渡してソケットへ送るだけの殻。
/// 1本の接続で、ロビー・ルーム・ゲームの電文をすべて運ぶ（多重化）。
///
/// - 接続時に接続アクターを開き、本人へ session（プレイヤー識別子と復帰トークン）を送る
/// - テキストの電文を decode して渡す。形の違う電文は error を返す
/// - reconnect で、切断中の接続アクターへ付け替える（connection.receive）
/// - 切断したら接続アクターへ伝える。ルームにいれば再接続猶予（10秒）を待つ
import gleam/erlang/process.{type Selector, type Subject}
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/option.{type Option, Some}
import mist.{
  type Connection, type ResponseData, type WebsocketConnection,
  type WebsocketMessage, Binary, Closed, Custom, Shutdown, Text,
}
import rondo_server/connection/connection.{type Deps}
import rondo_server/connection/session_actor
import rondo_server/protocol/message.{type ServerMessage, ErrorMessage}

/// ソケットのプロセスが持つ状態。使っている接続アクターと、このソケットへの送信先。
type State {
  State(actor: Subject(session_actor.Message), socket: Subject(ServerMessage))
}

pub fn handle(req: Request(Connection), deps: Deps) -> Response(ResponseData) {
  mist.websocket(
    request: req,
    on_init: fn(_conn) { on_init(deps) },
    on_close: fn(state: State) { connection.close(state.actor, state.socket) },
    handler: fn(state, incoming, conn) { loop(state, incoming, conn, deps) },
  )
}

fn on_init(deps: Deps) -> #(State, Option(Selector(ServerMessage))) {
  // このソケットへの送信先。接続アクターからの電文は Custom として loop に届く。
  let socket: Subject(ServerMessage) = process.new_subject()
  let selector = process.new_selector() |> process.select(socket)
  let actor = connection.open(deps, socket)
  #(State(actor:, socket:), Some(selector))
}

fn loop(
  state: State,
  incoming: WebsocketMessage(ServerMessage),
  conn: WebsocketConnection,
  deps: Deps,
) -> mist.Next(State, ServerMessage) {
  case incoming {
    Text(text) ->
      case message.decode_client(text) {
        Ok(parsed) -> {
          let actor =
            connection.receive(deps, state.actor, state.socket, parsed)
          mist.continue(State(..state, actor:))
        }
        Error(_) -> {
          send(conn, ErrorMessage("bad-message", "電文の形が正しくありません。"))
          mist.continue(state)
        }
      }
    // 接続アクターから届いた電文（返信・ルームの配信）をそのまま送る。
    Custom(outgoing) -> {
      send(conn, outgoing)
      mist.continue(state)
    }
    // rondo はテキストフレームで多重化する。バイナリは想定しないので捨てる。
    Binary(_) -> mist.continue(state)
    Closed | Shutdown -> mist.stop()
  }
}

fn send(conn: WebsocketConnection, outgoing: ServerMessage) -> Nil {
  let _ = mist.send_text_frame(conn, message.encode_server(outgoing))
  Nil
}
