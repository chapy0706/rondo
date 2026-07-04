import gleam/bytes_tree
import gleam/erlang/process
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/int
import gleam/io
import mist.{type Connection, type ResponseData}
import rondo_server/echo_ws

/// echo サーバーが待ち受けるポート。デプロイ時はここを変える（値の直書きを避けた命名）。
const port = 3000

/// HTTP パスの振り分け先。純粋な判定として切り出し、テスト対象にする。
pub type Route {
  /// WebSocket の echo エンドポイント。
  EchoWs
  /// それ以外。稼働確認用の索引を返す。
  Index
}

/// rondo リアルタイム基盤のエントリーポイント。
///
/// mist で WebSocket サーバーを起動し、/ws で echo を返す（ADR 0005）。
/// Docker から到達できるよう全インターフェースで待ち受ける。
/// ルームアクター・接続アクターは issue-09 以降で載せる。
pub fn main() {
  let assert Ok(_) =
    handle
    |> mist.new
    |> mist.bind("0.0.0.0")
    |> mist.port(port)
    |> mist.start

  io.println("rondo server listening on ws://0.0.0.0:" <> int.to_string(port))
  process.sleep_forever()
}

/// パスセグメントから振り分け先を決める純粋な関数。
pub fn route(path_segments: List(String)) -> Route {
  case path_segments {
    ["ws"] -> EchoWs
    _ -> Index
  }
}

/// 受け取ったリクエストを振り分け先に応じて処理する。
fn handle(req: Request(Connection)) -> Response(ResponseData) {
  case route(request.path_segments(req)) {
    EchoWs -> echo_ws.handle(req)
    Index -> index()
  }
}

/// 稼働確認用の索引。ブラウザで開いたときに生存を確認できる。
fn index() -> Response(ResponseData) {
  response.new(200)
  |> response.set_body(mist.Bytes(bytes_tree.from_string("rondo server")))
}
