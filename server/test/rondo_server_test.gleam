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
