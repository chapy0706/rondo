import gleam/dynamic
import gleeunit/should
import rondo_server/protocol/message.{GameState, GameStateTo}

/// 種別名は packages/contracts の ServerMessage の type と一致させる（ADR 0009）。
/// TS 側は contracts.test.ts で同じ文字列を型として確かめている。
pub fn game_state_type_matches_contract_test() {
  GameState(game_type: "g", room_id: "r", payload: dynamic.string("p"))
  |> message.type_name
  |> should.equal("game-state")
}

pub fn game_state_to_type_matches_contract_test() {
  GameStateTo(
    game_type: "g",
    room_id: "r",
    to: "p1",
    payload: dynamic.string("p"),
  )
  |> message.type_name
  |> should.equal("game-state-to")
}
