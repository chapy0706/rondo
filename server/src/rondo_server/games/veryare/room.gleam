/// veryare をルームに載せる（ADR 0024 / 0030）。
///
/// 純粋な状態機械（games/veryare/game）を、ルームの差し込み口（room/driver）に包む。
/// ルームは veryare を知らず、ここが返す RoomSpec と箱を動かすだけである。
/// タイマーは各フェーズの長さで張り、フェーズの通し番号（step）を token にして、
/// 早く終わったフェーズの古いタイマーを状態機械の側で無視する。
///
/// CPU（ADR 0038 / issue-33）は、作成時の設定に応じて接続を持たない参加者（cpu-N・
/// 「CPU N」）としてルームに加える。探索開始の瞬間に、まだ隠れている隠れ側全員の状態を
/// 全員へ同じ内容で一括配信する（ADR 0025 / 0035）。
///
/// 鬼 CPU（issue-34）がいる探索フェーズでは、0.5秒ごとのタイマー（tick）で鬼 CPU を
/// 歩かせ、そのたびに鬼の状態（位置・向き・ポーズ・開いた襖）を全員へ送る。tick の
/// タイマーは、フェーズのタイマーと見分けるため、負の token（-1 - step）を持つ。
///
/// 観戦（issue-28）: 人間の鬼も、探索中に動くたびに同じ形で鬼の状態を全員へ送る。
/// 「まだ隠れている」隠れ側の一覧が変わったら（発見・失格・離脱）、一覧を全員へ送る。
/// 一覧から外れた隠れ側のクライアントは、観戦（鬼 TPS 視点）に切り替える。
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/set
import rondo_server/games/veryare/game.{
  type AreaState, type Game, type Outcome, type Phase, AreaCounting, AreaReady,
  AreaWaiting, Ended, Exploration, HidersWin, NotEnoughPlayers, OniSelection,
  OniWins, Painting, Preparation, Reveal,
}
import rondo_server/games/veryare/hider_cpu.{
  type Placement, Crouching, Lying, Standing,
}
import rondo_server/games/veryare/oni_cpu.{type Strength}
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/result as final_result
import rondo_server/games/veryare/stage
import rondo_server/room/driver.{type Driver, type Effect}
import rondo_server/room/room_actor.{
  type Player, type PlayerId, type RoomId, type RoomSpec, Player, PlayerId,
  RoomSpec,
}

/// ゲーム種別。マニフェストの id と一致させる（ADR 0023）。
pub const game_type = "veryare"

/// 最小人数（鬼1 + 隠れ側1 / ADR 0030）。
pub const min_players = 2

/// 定員（鬼1 + 隠れ側4 / ADR 0030）。
pub const max_players = 5

/// 同時にアクティブにできるルーム数（ADR 0030）。ルーム台帳に渡す。
pub const max_active_rooms = 3

/// 探索フェーズの長さの選択肢（秒）。20秒刻み、基本40秒（ADR 0024）。
pub const exploration_choices = [40, 60, 80, 100, 120]

/// ステージの種を引く範囲。pick（本番は int.random）にこの範囲で種を引かせる。
const stage_seed_range = 2_147_483_647

/// 探索フェーズの長さの基本値（秒）。
pub const default_exploration_seconds = 40

/// CPU の選択肢の値。0 = なし、1〜3 = 隠れ側 CPU の数、4 = 鬼 CPU。
pub const cpu_choices = [0, 1, 2, 3, 4]

/// 鬼 CPU の強さの選択肢の値。0 = よわい、1 = ふつう、2 = つよい。
pub const cpu_strength_choices = [0, 1, 2]

/// 鬼 CPU が歩く間隔（ミリ秒）。
const tick_ms = 500

/// ルームに加える CPU。
pub type CpuChoice {
  NoCpu
  /// 隠れ側 CPU（1〜3体）。
  HiderCpus(count: Int)
  /// 鬼 CPU（1体）。
  OniCpu
}

/// ルーム作成時の設定。
pub type Settings {
  Settings(exploration_seconds: Int, cpu: CpuChoice, strength: Strength)
}

/// create-room の settings（unknown）を検証する。省略時は基本値。
/// 選択肢にない値は拒否する（境界での unknown 検証）。
pub fn parse_settings(raw: Option(Dynamic)) -> Result(Settings, Nil) {
  case raw {
    None -> Ok(Settings(default_exploration_seconds, NoCpu, oni_cpu.Normal))
    Some(data) -> {
      let decoder = {
        use seconds <- decode.optional_field(
          "explorationSeconds",
          default_exploration_seconds,
          decode.int,
        )
        use cpu <- decode.optional_field("cpu", 0, decode.int)
        use strength <- decode.optional_field("cpuStrength", 1, decode.int)
        decode.success(#(seconds, cpu, strength))
      }
      case decode.run(data, decoder) {
        Ok(#(seconds, cpu, strength)) ->
          case
            list.contains(exploration_choices, seconds),
            list.contains(cpu_choices, cpu),
            list.contains(cpu_strength_choices, strength)
          {
            True, True, True ->
              Ok(Settings(seconds, cpu_choice(cpu), strength_of(strength)))
            _, _, _ -> Error(Nil)
          }
        Error(_) -> Error(Nil)
      }
    }
  }
}

fn strength_of(value: Int) -> Strength {
  case value {
    0 -> oni_cpu.Weak
    2 -> oni_cpu.Strong
    _ -> oni_cpu.Normal
  }
}

fn cpu_choice(value: Int) -> CpuChoice {
  case value {
    0 -> NoCpu
    4 -> OniCpu
    count -> HiderCpus(count)
  }
}

/// 設定に応じた CPU の参加者（cpu-1 から順に、表示名は「CPU N」）。
fn cpu_players(cpu: CpuChoice) -> List(Player) {
  let count = case cpu {
    NoCpu -> 0
    HiderCpus(count) -> count
    OniCpu -> 1
  }
  numbered(1, count)
  |> list.map(fn(n) {
    Player(
      id: PlayerId("cpu-" <> int.to_string(n)),
      name: "CPU " <> int.to_string(n),
    )
  })
}

fn numbered(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..numbered(from + 1, to)]
  }
}

/// 状態機械に渡す CPU の内訳（どの参加者が CPU か）。
fn cpus_of(cpu: CpuChoice, strength: Strength) -> game.Cpus(PlayerId) {
  let ids = list.map(cpu_players(cpu), fn(player) { player.id })
  case cpu {
    OniCpu ->
      game.Cpus(
        hiders: [],
        oni: list.first(ids) |> option.from_result,
        strength:,
      )
    _ -> game.Cpus(hiders: ids, oni: None, strength:)
  }
}

/// 本番のルーム設定。フェーズの長さは ADR 0024 の値、鬼選出の乱数は int.random。
pub fn spec(id: RoomId, settings: Settings) -> RoomSpec {
  spec_with(
    id,
    settings,
    game.durations(exploration_ms: settings.exploration_seconds * 1000),
    int.random,
  )
}

/// フェーズの長さと乱数を差し替えられるルーム設定（テスト用）。
pub fn spec_with(
  id: RoomId,
  settings: Settings,
  durations: game.Durations,
  pick: fn(Int) -> Int,
) -> RoomSpec {
  RoomSpec(
    id:,
    game_type:,
    min_players:,
    max_players:,
    authority: None,
    driver: Some(fn(players) {
      start(players, durations, cpus_of(settings.cpu, settings.strength), pick)
    }),
    member_info: Some(room_info(settings)),
    bots: cpu_players(settings.cpu),
  )
}

// --- 箱 ------------------------------------------------------------------

fn start(
  players: List(PlayerId),
  durations: game.Durations,
  cpus: game.Cpus(PlayerId),
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  // ステージは開始時に、骨格10種から1つを選び部屋を割り当てる（ADR 0032）。
  let layout = stage.generate(pick(stage_seed_range))
  let initial = game.new_with(players, durations, layout, cpus)
  #(wrap(initial, pick), phase_effects(initial))
}

fn wrap(state: Game(PlayerId), pick: fn(Int) -> Int) -> Driver(PlayerId) {
  driver.new(
    on_event: fn(player, payload) {
      case decode.run(payload, move_decoder()) {
        Ok(#(x, z, facing)) -> {
          let moved = game.move(state, player, x, z)
          let turned = case facing {
            Some(f) -> game.turn(moved, player, f)
            None -> moved
          }
          let #(next, effects) = step(state, turned, pick)
          #(
            next,
            list.append(effects, human_oni_effects(state, turned, player)),
          )
        }
        Error(_) -> #(wrap(state, pick), [])
      }
    },
    on_leave: fn(player) { step(state, game.leave(state, player), pick) },
    on_wake: fn(token) {
      case token == tick_token(state) {
        True -> ticked(state, game.tick(state), pick)
        False -> step(state, game.advance(state, token, pick), pick)
      }
    },
    on_join: fn(player) {
      joined(state, game.join(state, player), player, pick)
    },
    accepts_join: fn() { game.accepts_join(state) },
    is_over: fn() {
      case state.phase {
        Ended(_) -> True
        _ -> False
      }
    },
  )
}

/// 通知の中身（フェーズ・鬼・エリアの色）が変わったときだけ全員へ通知する。
/// タイマーは step が進んだとき（フェーズの切り替えと、鬼選出のカウント開始）だけ張る。
fn step(
  before: Game(PlayerId),
  after: Game(PlayerId),
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let effects = case after.step == before.step {
    False -> phase_effects(after)
    True ->
      case notice_of(after) == notice_of(before) {
        True -> []
        False -> [driver.Broadcast(phase_payload(after))]
      }
  }
  // まだ隠れている隠れ側が変わったら、一覧を全員へ送る（観戦への切り替えに使う）。
  let hiding = case after.still_hiding == before.still_hiding {
    True -> []
    False -> [driver.Broadcast(hiding_payload(after))]
  }
  #(wrap(after, pick), list.flatten([effects, hiding, finish(before, after)]))
}

/// 終了（Ended）に入った瞬間に、結果を全員へ送る（issue-42）。終了経路はすべて
/// ここを通る（答え合わせの満了、不成立）。終了の通知（phase: ended）の後に出す。
fn finish(
  before: Game(PlayerId),
  after: Game(PlayerId),
) -> List(Effect(PlayerId)) {
  case before.phase, final_result.of(after) {
    Ended(_), _ -> []
    _, Ok(#(order, standings)) -> [driver.Finish(order, standings)]
    _, Error(Nil) -> []
  }
}

/// 人間の鬼が探索中に動いたら、鬼の状態を全員へ送る（位置か向きが変わったときだけ）。
fn human_oni_effects(
  before: Game(PlayerId),
  after: Game(PlayerId),
  player: PlayerId,
) -> List(Effect(PlayerId)) {
  let changed =
    dict.get(before.positions, player) != dict.get(after.positions, player)
    || dict.get(before.facings, player) != dict.get(after.facings, player)
  case after.phase, after.oni == Some(player), after.oni_cpu, changed {
    Exploration, True, None, True ->
      case oni_payload(after) {
        Some(payload) -> [driver.Broadcast(payload)]
        None -> []
      }
    _, _, _, _ -> []
  }
}

/// 鬼 CPU の tick のタイマーの token。フェーズのタイマー（step、0 以上）と重ならない。
fn tick_token(state: Game(PlayerId)) -> Int {
  -1 - state.step
}

/// 鬼 CPU の tick の後。鬼の状態を全員へ送り、探索が続いていれば次の tick を張る。
/// 発見で勝敗が決まったら（step が進んだら）、フェーズの通知とタイマーも出す。
fn ticked(
  before: Game(PlayerId),
  after: Game(PlayerId),
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let #(next, effects) = step(before, after, pick)
  let oni = case oni_payload(after) {
    Some(payload) -> [driver.Broadcast(payload)]
    None -> []
  }
  let again = case game.oni_cpu_active(after) && after.step == before.step {
    True -> [driver.WakeAfter(tick_ms, tick_token(after))]
    False -> []
  }
  #(next, list.flatten([oni, effects, again]))
}

/// 途中参加。全員への通知が出なかったとき（エリアの色が変わらない等）は、参加した
/// 本人にだけ今の状態を送る。途中から入った人も、今のフェーズとエリアの色が分かる。
fn joined(
  before: Game(PlayerId),
  after: Game(PlayerId),
  player: PlayerId,
  pick: fn(Int) -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  case step(before, after, pick) {
    #(next, []) -> #(next, [driver.Deliver([player], phase_payload(after))])
    stepped -> stepped
  }
}

/// 全員へ知らせる中身。これが変わったときだけ通知する（隠れ側の位置は含めない）。
type Notice {
  Notice(
    phase: Phase,
    step: Int,
    oni: Option(PlayerId),
    area: Option(AreaState),
  )
}

fn notice_of(state: Game(PlayerId)) -> Notice {
  Notice(
    phase: state.phase,
    step: state.step,
    oni: state.oni,
    area: area_of(state),
  )
}

/// 鬼希望エリアの色。鬼選出中だけ意味を持つ。
fn area_of(state: Game(PlayerId)) -> Option(AreaState) {
  case state.phase {
    OniSelection -> Some(game.area_state(state))
    _ -> None
  }
}

/// フェーズが切り替わったときの通知とタイマー。探索の開始時には、隠れ側の状態の
/// 一括配信を続けて送る（全員へ同じ内容 / ADR 0035）。
fn phase_effects(state: Game(PlayerId)) -> List(Effect(PlayerId)) {
  let notice = driver.Broadcast(phase_payload(state))
  let snapshot = case state.phase {
    Exploration -> [driver.Broadcast(hiders_payload(state))]
    _ -> []
  }
  // 鬼 CPU がいれば、探索の開始から 0.5秒ごとに歩かせる。
  let walking = case game.oni_cpu_active(state) {
    True -> [driver.WakeAfter(tick_ms, tick_token(state))]
    False -> []
  }
  let timer = case game.phase_duration(state) {
    Some(ms) -> [driver.WakeAfter(ms, state.step)]
    None -> []
  }
  list.flatten([[notice], snapshot, timer, walking])
}

// --- 電文 ----------------------------------------------------------------

/// 移動の報告 { type: "move", x, z, facing? }。数値は整数でも受け付ける。
/// facing（向き）は任意で、観戦者へ送る鬼の向きに使う（issue-28）。
fn move_decoder() -> decode.Decoder(#(Float, Float, Option(Float))) {
  use kind <- decode.field("type", decode.string)
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  use facing <- decode.optional_field("facing", None, decode.optional(number()))
  case kind {
    "move" -> decode.success(#(x, z, facing))
    _ -> decode.failure(#(0.0, 0.0, None), "move")
  }
}

/// まだ隠れている隠れ側の一覧 { type: "hiding", playerIds }（参加順）。
fn hiding_payload(state: Game(PlayerId)) -> Dynamic {
  let ids =
    state.players
    |> list.filter(fn(id) { set.contains(state.still_hiding, id) })
    |> list.map(fn(id) {
      let PlayerId(raw) = id
      dynamic.string(raw)
    })
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("hiding")),
    #(dynamic.string("playerIds"), dynamic.list(ids)),
  ])
}

fn number() -> decode.Decoder(Float) {
  decode.one_of(decode.float, [decode.int |> decode.map(int.to_float)])
}

/// 入室後の案内。探索時間はルーム一覧には出さず、ここで初めて伝える。
fn room_info(settings: Settings) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("room-info")),
    #(
      dynamic.string("explorationSeconds"),
      dynamic.int(settings.exploration_seconds),
    ),
  ])
}

/// フェーズの通知。全員に同じ内容を送るため、隠れ側の位置は載せない。
/// area は鬼希望エリアの色（waiting 赤 / ready 緑 / counting 青）で、鬼選出中だけ載せる。
fn phase_payload(state: Game(PlayerId)) -> Dynamic {
  let oni = case state.oni {
    Some(PlayerId(id)) -> dynamic.string(id)
    None -> dynamic.nil()
  }
  let duration = case game.phase_duration(state) {
    Some(ms) -> dynamic.int(ms)
    None -> dynamic.nil()
  }
  let outcome = case state.phase {
    Reveal(result) | Ended(result) -> dynamic.string(outcome_name(result))
    _ -> dynamic.nil()
  }
  let area = case area_of(state) {
    Some(AreaWaiting) -> dynamic.string("waiting")
    Some(AreaReady) -> dynamic.string("ready")
    Some(AreaCounting) -> dynamic.string("counting")
    None -> dynamic.nil()
  }
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("phase")),
    #(dynamic.string("phase"), dynamic.string(phase_name(state.phase))),
    #(dynamic.string("durationMs"), duration),
    #(dynamic.string("area"), area),
    #(dynamic.string("oni"), oni),
    #(dynamic.string("outcome"), outcome),
  ])
}

/// 探索開始時の、まだ隠れている隠れ側全員の状態（ADR 0025 / 0035）。
/// { type: "hiders", hiders: [{ playerId, x, z, facing, pose, paint }] }。
/// 人間の隠れ側の向き・ポーズ・ペイントは、まだ持たないので null（issue-25 で足す）。
/// 隠れ CPU のペイントは全面1色で { kind: "uniform", color: "#rrggbb" }。
fn hiders_payload(state: Game(PlayerId)) -> Dynamic {
  let hiders =
    game.hider_states(state)
    |> list.map(fn(entry) {
      let #(PlayerId(id), position, placement) = entry
      let #(facing, pose, paint) = case placement {
        Some(p) -> #(
          dynamic.float(p.facing),
          dynamic.string(pose_name(p)),
          dynamic.properties([
            #(dynamic.string("kind"), dynamic.string("uniform")),
            #(dynamic.string("color"), dynamic.string(palette.to_hex(p.color))),
          ]),
        )
        None -> #(dynamic.nil(), dynamic.nil(), dynamic.nil())
      }
      dynamic.properties([
        #(dynamic.string("playerId"), dynamic.string(id)),
        #(dynamic.string("x"), dynamic.float(position.x)),
        #(dynamic.string("z"), dynamic.float(position.z)),
        #(dynamic.string("facing"), facing),
        #(dynamic.string("pose"), pose),
        #(dynamic.string("paint"), paint),
      ])
    })
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("hiders")),
    #(dynamic.string("hiders"), dynamic.list(hiders)),
  ])
}

/// 鬼 CPU の状態（人間の鬼も issue-28 で同じ形で送る）。
/// { type: "oni", playerId, x, z, facing, pose, openDoors: [{ corridor: {x, z}, slot: {x, z} }] }。
fn oni_payload(state: Game(PlayerId)) -> Option(Dynamic) {
  let cell = fn(c: stage.Cell) {
    dynamic.properties([
      #(dynamic.string("x"), dynamic.int(c.x)),
      #(dynamic.string("z"), dynamic.int(c.z)),
    ])
  }
  let door = fn(d: stage.Door) {
    dynamic.properties([
      #(dynamic.string("corridor"), cell(d.corridor)),
      #(dynamic.string("slot"), cell(d.slot)),
    ])
  }
  // 鬼 CPU は自分の状態から、人間の鬼は報告された位置と向きから作る。
  // 人間の鬼が開けた襖は、襖を実装する issue-29 まで空。
  let state_of = case state.oni, state.oni_cpu {
    Some(oni), Some(walker) ->
      Ok(#(
        oni,
        walker.position,
        walker.facing,
        list.map(set.to_list(walker.open_doors), door),
      ))
    Some(oni), None ->
      case dict.get(state.positions, oni) {
        Ok(position) ->
          Ok(
            #(
              oni,
              #(position.x, position.z),
              result.unwrap(dict.get(state.facings, oni), 0.0),
              [],
            ),
          )
        Error(Nil) -> Error(Nil)
      }
    None, _ -> Error(Nil)
  }
  case state_of {
    Ok(#(PlayerId(id), #(x, z), facing, doors)) ->
      Some(
        dynamic.properties([
          #(dynamic.string("type"), dynamic.string("oni")),
          #(dynamic.string("playerId"), dynamic.string(id)),
          #(dynamic.string("x"), dynamic.float(x)),
          #(dynamic.string("z"), dynamic.float(z)),
          #(dynamic.string("facing"), dynamic.float(facing)),
          #(dynamic.string("pose"), dynamic.string("standing")),
          #(dynamic.string("openDoors"), dynamic.list(doors)),
        ]),
      )
    Error(Nil) -> None
  }
}

fn pose_name(placement: Placement) -> String {
  case placement.pose {
    Standing -> "standing"
    Crouching -> "crouching"
    Lying -> "lying"
  }
}

fn phase_name(phase: Phase) -> String {
  case phase {
    OniSelection -> "oni-selection"
    Preparation -> "preparation"
    Painting -> "painting"
    Exploration -> "exploration"
    Reveal(_) -> "reveal"
    Ended(_) -> "ended"
  }
}

fn outcome_name(outcome: Outcome) -> String {
  case outcome {
    OniWins -> "oni-wins"
    HidersWin -> "hiders-win"
    NotEnoughPlayers -> "not-enough-players"
  }
}
