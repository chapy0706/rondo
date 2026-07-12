/// Tilt Maze のサーバー権威（ADR 0008 の箱に載せるゲーム固有判定）。
///
/// 順位はサーバーが受信した順で確定する（ADR 0014）。クライアントは各面のゴール到達を
/// 通知するだけで（issue-12）、決定権を持たない。最終面のゴールを受け取った順に完走者を
/// 並べ、全員が完走したらゲーム終了とする。ペイロードは unknown として受け取り、ここで
/// 検証する（ADR 0009）。
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/list
import rondo_server/room/authority.{
  type Authority, type Outcome, Outcome, Ranking,
}
import rondo_server/room/room_actor.{type PlayerId}

/// 完走とみなす面。クライアント（issue-12）の最終面（TOTAL_LEVELS）に対応する。
pub const final_level = 10

/// レース進行。finishers は完走した順（＝サーバー受信順）に並ぶ。
pub type Race {
  Race(participants: List(PlayerId), finishers: List(PlayerId))
}

/// 参加者を決めてレースを始める。
pub fn new_race(players: List(PlayerId)) -> Race {
  Race(participants: players, finishers: [])
}

/// あるプレイヤーの面クリアを反映する。最終面のゴールで完走者に加える。
/// 参加者でない・すでに完走済み・最終面未満は無視する（受信順を汚さない）。
pub fn record_goal(race: Race, player: PlayerId, level: Int) -> Race {
  let eligible =
    level >= final_level
    && list.contains(race.participants, player)
    && !list.contains(race.finishers, player)
  case eligible {
    True -> Race(..race, finishers: list.append(race.finishers, [player]))
    False -> race
  }
}

/// 参加者全員が完走したか。
pub fn is_over(race: Race) -> Bool {
  let total = list.length(race.participants)
  total > 0 && list.length(race.finishers) >= total
}

/// 完走順を 1 始まりの順位にした最終結果。
pub fn to_outcome(race: Race) -> Outcome(PlayerId) {
  Outcome(
    list.index_map(race.finishers, fn(player, index) {
      Ranking(player:, rank: index + 1)
    }),
  )
}

/// tilt_maze のサーバー権威を作る。room_actor の RoomSpec.authority に渡す（ADR 0008）。
pub fn create(players: List(PlayerId)) -> Authority(PlayerId) {
  box(new_race(players))
}

fn box(race: Race) -> Authority(PlayerId) {
  authority.new(
    on_event: fn(player, payload) { box(apply_payload(race, player, payload)) },
    is_over: fn() { is_over(race) },
    outcome: fn() { to_outcome(race) },
  )
}

fn apply_payload(race: Race, player: PlayerId, payload: Dynamic) -> Race {
  case decode.run(payload, goal_level_decoder()) {
    Ok(level) -> record_goal(race, player, level)
    // goal でない・不正なペイロードは無視する（境界での unknown 検証 / ADR 0009）。
    Error(_) -> race
  }
}

fn goal_level_decoder() -> decode.Decoder(Int) {
  use kind <- decode.field("type", decode.string)
  use level <- decode.field("level", decode.int)
  case kind {
    "goal" -> decode.success(level)
    _ -> decode.failure(0, "goal event")
  }
}
