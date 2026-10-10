import gleam/bytes_tree
import gleam/erlang/process
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/int
import gleam/io
import gleam/string
import mist.{type Connection, type ResponseData}
import rondo_server/connection/connection.{type Deps, Deps}
import rondo_server/connection/heap_guard
import rondo_server/connection/heartbeat
import rondo_server/connection/session
import rondo_server/connection/sessions
import rondo_server/connection/websocket
import rondo_server/games/catalog
import rondo_server/games/timing
import rondo_server/room/room_directory
import rondo_server/room/room_supervisor

/// サーバーが待ち受けるポートの既定。環境変数 RONDO_PORT で変えられる（issue-49。
/// ボット同士の対戦を、開発用のサーバーと別のポートで動かすため）。
const default_port = 3000

/// HTTP パスの振り分け先。純粋な判定として切り出し、テスト対象にする。
pub type Route {
  /// リアルタイムの WebSocket エンドポイント（issue-31）。
  RealtimeWs
  /// それ以外。稼働確認用の索引を返す。
  Index
}

/// rondo リアルタイム基盤のエントリーポイント。
///
/// ルームの監視（room_supervisor）と台帳（room_directory）を起動し、mist で
/// WebSocket サーバーを起動する（ADR 0005）。/ws が実接続の入口（issue-31）。
/// Docker から到達できるよう全インターフェースで待ち受ける。
pub fn main() {
  let assert Ok(supervisor) = room_supervisor.start()
  let assert Ok(directory) =
    room_directory.start(supervisor.data, catalog.room_limits())
  let assert Ok(registry) = sessions.start()
  // ソケット1本ごとのメモリ上限（issue-51）が、この OTP で実質効くか。効かないなら1行警告する。
  heap_guard.warn_if_unsupported()
  let port = port_from_env(get_env("RONDO_PORT"))
  // テスト用のフェーズ時間の短縮（issue-49）。環境変数が無ければ本番の時間のまま。
  let phase_timing = timing.from_env(get_env(timing.env_name))
  case phase_timing {
    timing.Faster(divisor) ->
      io.println(
        "rondo server: フェーズ時間を 1/" <> int.to_string(divisor) <> " に縮めています（テスト用）",
      )
    timing.Normal -> Nil
  }
  let deps =
    Deps(
      session: session.Deps(directory: directory.data, timing: phase_timing),
      sessions: registry.data,
      grace_ms: connection.default_grace_ms,
      heartbeat: heartbeat.default_config(),
    )

  let assert Ok(_) =
    fn(req) { handle(req, deps) }
    |> mist.new
    |> mist.bind("0.0.0.0")
    |> mist.port(port)
    |> mist.start

  io.println("rondo server listening on ws://0.0.0.0:" <> int.to_string(port))
  process.sleep_forever()
}

/// 環境変数の値（無ければ Error）から、待ち受けるポートを決める。1〜65535 の整数のときだけ使う。
pub fn port_from_env(value: Result(String, Nil)) -> Int {
  case value {
    Ok(raw) ->
      case int.parse(string.trim(raw)) {
        Ok(port) if port >= 1 && port <= 65_535 -> port
        _ -> default_port
      }
    Error(Nil) -> default_port
  }
}

/// 環境変数を読む（無ければ Error）。
@external(erlang, "rondo_server_ffi", "get_env")
fn get_env(name: String) -> Result(String, Nil)

/// パスセグメントから振り分け先を決める純粋な関数。
pub fn route(path_segments: List(String)) -> Route {
  case path_segments {
    ["ws"] -> RealtimeWs
    _ -> Index
  }
}

/// 受け取ったリクエストを振り分け先に応じて処理する。
fn handle(req: Request(Connection), deps: Deps) -> Response(ResponseData) {
  case route(request.path_segments(req)) {
    RealtimeWs -> websocket.handle(req, deps)
    Index -> index()
  }
}

/// 稼働確認用の索引。ブラウザで開いたときに生存を確認できる。
fn index() -> Response(ResponseData) {
  response.new(200)
  |> response.set_body(mist.Bytes(bytes_tree.from_string("rondo server")))
}
