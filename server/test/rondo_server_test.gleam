import gleeunit
import gleeunit/should
import rondo_server.{EchoWs, Index}

pub fn main() {
  gleeunit.main()
}

/// /ws は echo エンドポイントに振り分ける。
pub fn route_ws_test() {
  ["ws"]
  |> rondo_server.route
  |> should.equal(EchoWs)
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
