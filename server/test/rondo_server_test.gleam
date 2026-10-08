import gleeunit
import gleeunit/should
import rondo_server.{Index, RealtimeWs}

pub fn main() {
  gleeunit.main()
}

/// /ws はリアルタイムの WebSocket エンドポイントに振り分ける。
pub fn route_ws_test() {
  ["ws"]
  |> rondo_server.route
  |> should.equal(RealtimeWs)
}

/// それ以外のパスは索引に振り分ける。
pub fn route_index_test() {
  []
  |> rondo_server.route
  |> should.equal(Index)

  ["health"]
  |> rondo_server.route
  |> should.equal(Index)
}

/// 待ち受けるポートは、環境変数 RONDO_PORT が正しい値のときだけ変える（issue-49）。
/// 無い・正しくない値なら、これまでどおり 3000。
pub fn port_from_env_test() {
  rondo_server.port_from_env(Error(Nil)) |> should.equal(3000)
  rondo_server.port_from_env(Ok("3300")) |> should.equal(3300)
  rondo_server.port_from_env(Ok("abc")) |> should.equal(3000)
  rondo_server.port_from_env(Ok("0")) |> should.equal(3000)
  rondo_server.port_from_env(Ok("70000")) |> should.equal(3000)
}
