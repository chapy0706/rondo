import gleam/erlang/process.{type Selector}
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/option.{type Option, None}
import mist.{
  type Connection, type ResponseData, type WebsocketConnection,
  type WebsocketMessage, Binary, Closed, Custom, Shutdown, Text,
}

/// echo の WebSocket 接続を確立し、受信したフレームをそのまま送り返す。
///
/// リアルタイム基盤の最小状態（ADR 0005）。接続アクター・ルームアクターは
/// issue-09 / issue-10 で載せる。ここでは状態を持たず、ただ返すだけに徹する。
pub fn handle(req: Request(Connection)) -> Response(ResponseData) {
  mist.websocket(
    request: req,
    on_init: on_init,
    on_close: on_close,
    handler: loop,
  )
}

/// 接続開始時。echo は状態を持たないため Nil を返す。ユーザーメッセージも受けない。
fn on_init(_conn: WebsocketConnection) -> #(Nil, Option(Selector(message))) {
  #(Nil, None)
}

/// 接続終了時。解放する資源はない。
fn on_close(_state: Nil) -> Nil {
  Nil
}

/// 受信ごとに呼ばれる。テキスト・バイナリはそのまま返し、切断で終了する。
fn loop(
  state: Nil,
  message: WebsocketMessage(message),
  conn: WebsocketConnection,
) -> mist.Next(Nil, message) {
  case message {
    Text(text) -> {
      let _ = mist.send_text_frame(conn, text)
      mist.continue(state)
    }
    Binary(data) -> {
      let _ = mist.send_binary_frame(conn, data)
      mist.continue(state)
    }
    Closed | Shutdown -> mist.stop()
    Custom(_) -> mist.continue(state)
  }
}
