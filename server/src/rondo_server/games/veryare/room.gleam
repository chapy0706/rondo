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
///
/// 射撃（issue-27）: 鬼の game-event { type: "shoot", target } を受けた時刻を付けて、状態機械の
/// shoot に渡す。命中の知らせは、上の一覧の更新で全員に届く（専用の電文は作らない）。
///
/// ステージの選び方（issue-44）: 作成時の設定 stage で、ランダム間取り（0、既定）か平屋（1）かを
/// 選ぶ。ロビーに選択肢を出すのは issue-46。平屋と CPU の組み合わせは、見通しと CPU の一般化
/// （issue-45）まで拒む。
///
/// 広い屋敷（issue-65 / ADR 0048）: stage 2 = おまかせ（1 段目で 4 分の 1 の広い屋敷、2 段目で種類の中から
/// 一様に）、3 = 広い屋敷だけ（ボット・E2E・開発用）。旗 wide_ready が False の間は、おまかせは 10 種だけを
/// 選び（ふつうだけと同じ結果）、3 は環境変数 RONDO_WIDE_DEV=1 のときだけ受け付ける。広い屋敷のときは、
/// 準備移動と探索の長さを骨格に合わせ（stage_timing）、ルーム情報（探索時間）を、開始のときに全員へ、
/// 入り直した人には本人宛てで、送り直す。
///
/// 待機ルームのメンバー（issue-59 / ADR 0044）: 鬼選出の間だけ、待機ルームにいる人間の参加者の
/// 位置・向き・待機ポーズを、1通にまとめて全員へ送る。変わったときに 150 ms のタイマーを張り、
/// 起きたときに、最後に送った内容と違えば送る。張った後に step が進んでいたら送らず、まだ鬼選出
/// なら張り直す。途中参加・再接続の人には、本人宛てで今の様子を送る。待機ポーズの変更
/// （waiting-pose）は、受けた時刻を付けて状態機械に渡す（受け付けるかは状態機械が決める）。
///
/// 見逃しポイントといいね（issue-32 / ADR 0036）: 探索の開始に 0.5 秒ごとのタイマーを張り、起きる
/// たびに、まだ隠れている隠れ側へ見逃しポイントを足す（試合中は誰にも送らず、結果の行にだけ載せる）。
/// 人間の鬼の視界の報告（sight）は、状態機械に渡す。答え合わせの間のいいね（like）で数が変わったら、
/// いいねの数を全員へ送る。勝敗には使わない。
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/set
import gleam/string
import rondo_server/games/timing.{type Timing}
import rondo_server/games/veryare/game.{
  type AreaState, type Game, type Outcome, type Phase, AreaCounting, AreaReady,
  AreaWaiting, Ended, Exploration, HidersWin, NotEnoughPlayers, OniSelection,
  OniWins, Painting, Preparation, Reveal,
}
import rondo_server/games/veryare/hider_cpu.{
  type Placement, Crouching, Lying, Standing,
}
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/members
import rondo_server/games/veryare/missed_events
import rondo_server/games/veryare/oni_cpu.{type Strength}
import rondo_server/games/veryare/paint
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/result as final_result
import rondo_server/games/veryare/stage
import rondo_server/games/veryare/stage_notice
import rondo_server/games/veryare/stage_timing
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

/// ステージの選択肢の値。0 = ランダム間取り（ふつうだけ。既定）、1 = 平屋（issue-44）、
/// 2 = おまかせ、3 = 広い屋敷だけ（issue-65。3 は RONDO_WIDE_DEV=1 のときだけ受け付ける）。
pub const stage_choices = [0, 1, 2, 3]

/// 広い屋敷を、おまかせの抽選に入れるか（issue-65）。False の間、おまかせは 10 種だけを選ぶ。
pub const wide_ready = False

/// 広い屋敷だけ（stage 3）を受け付ける環境変数の名前。値が 1 のときだけ受け付ける。
pub const wide_dev_env_name = "RONDO_WIDE_DEV"

/// 鬼 CPU が歩く間隔（ミリ秒）。
const tick_ms = 500

/// 待機ルームのメンバーの通知を送る間隔（ミリ秒 / issue-59・ADR 0044）。
pub const members_interval_ms = 150

/// メンバーの通知のタイマーの token の上限。フェーズのタイマー（step、0 以上）とも、鬼 CPU の tick
/// （-1 - step）とも重ならないよう、これ以下の値を使う。
const members_token_base = -1_000_000

/// 見逃しポイントのタイマーの token の上限（issue-32）。メンバーの通知の token（-1_000_000 - step）
/// とも重ならないよう、これ以下の値を使う。
const missed_token_base = -2_000_000

/// ルームに加える CPU。
pub type CpuChoice {
  NoCpu
  /// 隠れ側 CPU（1〜3体）。
  HiderCpus(count: Int)
  /// 鬼 CPU（1体）。
  OniCpu
}

/// ステージの選び方（issue-44）。
pub type StageChoice {
  /// 骨格10種から選び、部屋を割り当てる（ADR 0032）。
  RandomLayout
  /// 固定ステージ「平屋」（ADR 0039）。
  Hiraya
  /// おまかせ（issue-65）。2 段の抽選（stage.generate_mixed）。wide_ready が False なら 10 種だけ。
  Mixed
  /// 広い屋敷だけ（issue-65。ボット・E2E・開発用）。
  WideOnly
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

/// create-room の settings（unknown）から、設定とステージの選び方を読む（issue-44）。
/// stage は省略時 0（ランダム間取り）。選択肢にない値は拒む。平屋と CPU の組み合わせは、
/// 見通しと CPU の一般化（issue-45）まで拒む。広い屋敷だけ（3）は、環境変数 RONDO_WIDE_DEV=1 の
/// ときだけ受け付ける（issue-65）。
pub fn parse_room(
  raw: Option(Dynamic),
) -> Result(#(Settings, StageChoice), Nil) {
  parse_room_with(raw, wide_dev(get_env(wide_dev_env_name)))
}

/// 環境変数 RONDO_WIDE_DEV の値（無ければ Error）から、広い屋敷だけ（3）を受け付けるかを決める。
/// 前後の空白を除いて 1 のときだけ受け付ける。
pub fn wide_dev(value: Result(String, Nil)) -> Bool {
  case value {
    Ok(raw) -> string.trim(raw) == "1"
    Error(Nil) -> False
  }
}

/// parse_room の中身。wide_dev は、広い屋敷だけ（3）を受け付けるか。
pub fn parse_room_with(
  raw: Option(Dynamic),
  wide_dev: Bool,
) -> Result(#(Settings, StageChoice), Nil) {
  use settings <- result.try(parse_settings(raw))
  let stage = case raw {
    None -> Ok(0)
    Some(data) ->
      decode.run(
        data,
        decode.optional_field("stage", 0, decode.int, decode.success),
      )
      |> result.replace_error(Nil)
  }
  case stage {
    Ok(0) -> Ok(#(settings, RandomLayout))
    Ok(1) if settings.cpu == NoCpu -> Ok(#(settings, Hiraya))
    Ok(2) -> Ok(#(settings, Mixed))
    Ok(3) if wide_dev -> Ok(#(settings, WideOnly))
    _ -> Error(Nil)
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
  spec_timed(id, settings, timing.Normal)
}

/// フェーズの長さにテスト用の短縮（issue-49）を当てはめたルーム設定。Normal なら spec と同じ。
/// ステージはランダム間取り。
pub fn spec_timed(id: RoomId, settings: Settings, timing: Timing) -> RoomSpec {
  spec_on(id, settings, RandomLayout, timing)
}

/// ステージを選んだルーム設定（issue-44）。
pub fn spec_on(
  id: RoomId,
  settings: Settings,
  stage: StageChoice,
  timing: Timing,
) -> RoomSpec {
  spec_with_stage(
    id,
    settings,
    stage,
    game.durations(exploration_ms: settings.exploration_seconds * 1000)
      |> timing.apply(timing),
    int.random,
  )
}

/// フェーズの長さと乱数を差し替えられるルーム設定（テスト用）。ステージはランダム間取り。
pub fn spec_with(
  id: RoomId,
  settings: Settings,
  durations: game.Durations,
  pick: fn(Int) -> Int,
) -> RoomSpec {
  spec_with_stage(id, settings, RandomLayout, durations, pick)
}

/// ステージ・フェーズの長さ・乱数を差し替えられるルーム設定（テスト用）。
pub fn spec_with_stage(
  id: RoomId,
  settings: Settings,
  stage: StageChoice,
  durations: game.Durations,
  pick: fn(Int) -> Int,
) -> RoomSpec {
  spec_with_clock(id, settings, stage, durations, pick, now_ms)
}

/// 時計も差し替えられるルーム設定（テスト用）。now は単調に増える時計（ミリ秒）。フェーズの開始時刻を
/// 覚え、送り直しのフェーズの通知の長さを、残りにするのに使う（ADR 0046）。
pub fn spec_with_clock(
  id: RoomId,
  settings: Settings,
  stage: StageChoice,
  durations: game.Durations,
  pick: fn(Int) -> Int,
  now: fn() -> Int,
) -> RoomSpec {
  RoomSpec(
    id:,
    game_type:,
    // ルーム名は作成の入口（connection/session）が入れる（issue-58）。
    name: "",
    min_players:,
    max_players:,
    authority: None,
    driver: Some(fn(players) {
      start(
        players,
        settings,
        durations,
        stage,
        cpus_of(settings.cpu, settings.strength),
        pick,
        now,
      )
    }),
    member_info: Some(room_info(settings.exploration_seconds)),
    bots: cpu_players(settings.cpu),
  )
}

// --- 箱 ------------------------------------------------------------------

/// ルームの外から差し替える物（鬼選出の乱数・単調に増える時計）と、いまのフェーズの開始時刻
/// （ミリ秒。step が進むたびに覚え直す）。開始時刻は、送り直しのフェーズの通知の長さを、残りに
/// するためだけに使う（勝敗とフェーズの遷移は、これまでどおりタイマーが決める / ADR 0046）。
/// info は、骨格が決まって、入室後の案内（member_info）の探索時間と違ったときのルーム情報（広い屋敷
/// だけ / issue-65）。入り直した人へ、本人宛てで送り直す。
type Env {
  Env(
    pick: fn(Int) -> Int,
    now: fn() -> Int,
    started_at: Int,
    info: Option(Dynamic),
  )
}

fn start(
  players: List(PlayerId),
  settings: Settings,
  durations: game.Durations,
  stage_choice: StageChoice,
  cpus: game.Cpus(PlayerId),
  pick: fn(Int) -> Int,
  now: fn() -> Int,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let layout = case stage_choice {
    // 開始時に、骨格10種から1つを選び部屋を割り当てる（ADR 0032）。
    RandomLayout -> Some(stage.generate(pick(stage_seed_range)))
    // おまかせと広い屋敷だけ（issue-65）。
    Mixed -> Some(stage.generate_mixed(pick(stage_seed_range), wide_ready))
    WideOnly -> Some(stage.generate_wide(pick(stage_seed_range)))
    Hiraya -> None
  }
  let #(initial, info) = case layout {
    Some(layout) -> {
      let exploration_seconds =
        stage_timing.exploration_seconds(
          layout.skeleton,
          settings.exploration_seconds,
        )
      // 骨格に合わせた長さ（ふつうは渡された長さのまま / issue-65）。
      let initial =
        game.new_with(
          players,
          stage_timing.durations_for(durations, layout.skeleton),
          layout,
          cpus,
        )
      let info = case exploration_seconds == settings.exploration_seconds {
        True -> None
        False -> Some(room_info(exploration_seconds))
      }
      #(initial, info)
    }
    // 平屋は CPU を持たない（parse_room が拒む / issue-45 まで）。
    None -> #(game.new_hiraya(players, durations), None)
  }
  // 探索時間が入室後の案内と違えば（広い屋敷）、ルーム情報を全員へ送り直す（issue-65）。
  let info_effects = case info {
    Some(payload) -> [driver.Broadcast(payload)]
    None -> []
  }
  // ステージの通知（issue-29a）を全員へ送ってから、フェーズの通知を送る。
  #(
    wrap(initial, Env(pick:, now:, started_at: now(), info:)),
    list.flatten([
      info_effects,
      [
        driver.Broadcast(stage_payload(initial)),
        driver.Broadcast(stage_notice.doors_payload(initial.open_doors)),
      ],
      phase_effects(initial),
    ]),
  )
}

fn wrap(state: Game(PlayerId), env: Env) -> Driver(PlayerId) {
  driver.new(
    on_event: fn(player, payload) {
      case decode.run(payload, shoot_decoder()) {
        // 鬼の射撃の申告（issue-27）。判定は状態機械が行い、時刻はここで付ける。
        Ok(target) ->
          step(state, game.shoot(state, player, target, now_ms()), env)
        Error(_) ->
          case decode.run(payload, stage_notice.open_door_decoder()) {
            // 襖を開ける報告（issue-29b）。開けられるかは状態機械が決める。
            Ok(door) -> step(state, game.open_door(state, player, door), env)
            Error(_) ->
              case decode.run(payload, paint.event_decoder()) {
                // ペイントとポーズの確定（issue-25 / issue-56）。受け付けるかは状態機械が決める。
                // 誰にも送らない（探索の開始の一括配信に載せる）。
                Ok(paint.Confirm(strokes:, pose:)) ->
                  step(state, game.confirm(state, player, strokes, pose), env)
                Error(_) ->
                  case decode.run(payload, members.waiting_pose_decoder()) {
                    // 待機ポーズの変更（issue-59）。受け付けるか（鬼選出中・人間・間）は状態機械が決める。
                    Ok(chosen) ->
                      step(
                        state,
                        game.set_waiting_pose(state, player, chosen, now_ms()),
                        env,
                      )
                    Error(_) -> missed_event(state, player, payload, env)
                  }
              }
          }
      }
    },
    on_leave: fn(player) { step(state, game.leave(state, player), env) },
    on_wake: fn(token) {
      case
        token <= missed_token_base,
        token <= members_token_base,
        token == tick_token(state)
      {
        True, _, _ -> missed_woke(state, token, env)
        False, True, _ -> members_woke(state, token, env)
        False, False, True -> ticked(state, game.tick(state), env)
        False, False, False ->
          step(state, game.advance(state, token, env.pick), env)
      }
    },
    on_join: fn(player) { joined(state, game.join(state, player), env) },
    accepts_join: fn() { game.accepts_join(state) },
    is_over: fn() {
      case state.phase {
        Ended(_) -> True
        _ -> False
      }
    },
  )
  // 送信先を登録した人（作った人・途中参加・再接続）には、本人宛てで、いま届けるべき状態を送る。
  |> driver.on_subscribe(fn(player) {
    subscriber_snapshot_with(
      state,
      player,
      env.now() - env.started_at,
      env.info,
    )
  })
}

/// 購読者に、いま届けるべき状態（本人宛て）。参加（入室の後）・途中参加・復帰（resync）の、どの経路も
/// これだけを使う（経路ごとに送る物を変えない。CPU ありのルームで、途中参加の人にフェーズが届かなかった
/// 不具合の直し）。ルーム情報（探索時間）は、ルームの入室後の案内（room_actor の member_info）が、同じ
/// 経路で送る。
///
/// | 状態 | 送るフェーズ |
/// | ステージの通知・襖の状態 | いつも（ステージは作成と同時に決まる） |
/// | フェーズ（エリアの色・鬼・長さ・結果） | いつも |
/// | 待機ルームのメンバー | 鬼選出 |
/// | 鬼の通知 | 探索・答え合わせ（鬼の位置が分かっているとき） |
/// | 隠れ側の一括配信・まだ隠れている人 | 探索・答え合わせ |
/// | いいね | 答え合わせ・終了（いいねがあるとき） |
/// elapsed_ms は、いまのフェーズが始まってからの時間。フェーズの通知の長さは、その時点からの残り
/// （長さ − 経過。0 未満にしない / ADR 0046）。
pub fn subscriber_snapshot(
  state: Game(PlayerId),
  player: PlayerId,
  elapsed_ms: Int,
) -> List(Effect(PlayerId)) {
  subscriber_snapshot_with(state, player, elapsed_ms, None)
}

/// subscriber_snapshot に、骨格が決まってからのルーム情報（info。広い屋敷の探索時間 / issue-65）を
/// 先頭に足したもの。入室後の案内（member_info）の後に届くので、案内の探索時間を正しい値で上書きする。
pub fn subscriber_snapshot_with(
  state: Game(PlayerId),
  player: PlayerId,
  elapsed_ms: Int,
  info: Option(Dynamic),
) -> List(Effect(PlayerId)) {
  let info = case info {
    Some(payload) -> [driver.Deliver([player], payload)]
    None -> []
  }
  list.flatten([
    info,
    [
      driver.Deliver([player], stage_payload(state)),
      driver.Deliver([player], stage_notice.doors_payload(state.open_doors)),
      driver.Deliver([player], phase_payload_after(state, elapsed_ms)),
    ],
    members_resend(state, player),
    oni_resend(state, player),
    hiders_resend(state, player),
    likes_resend(state, player),
  ])
}

/// フェーズの長さ total_ms のうち、elapsed_ms たった時点の残り（0 から total_ms の間）。
pub fn remaining_ms(total_ms: Int, elapsed_ms: Int) -> Int {
  int.clamp(total_ms - elapsed_ms, min: 0, max: total_ms)
}

/// 探索中・答え合わせ中に入り直した人へ、いまの鬼の通知を本人宛てで送る（届くまで鬼が見えないため）。
fn oni_resend(
  state: Game(PlayerId),
  player: PlayerId,
) -> List(Effect(PlayerId)) {
  case state.phase, oni_payload(state) {
    Exploration, Some(payload) | Reveal(_), Some(payload) -> [
      driver.Deliver([player], payload),
    ]
    _, _ -> []
  }
}

/// ステージの通知（issue-29a / ADR 0042）。選ばれたステージの地図のデータそのもの。
fn stage_payload(state: Game(PlayerId)) -> Dynamic {
  case state.ground {
    game.Skeleton(layout:, ..) -> stage_notice.payload(layout)
    game.Hiraya -> hiraya.notice()
  }
}

/// 移動の報告（move）。形の違う電文は無視する。
fn moved(
  state: Game(PlayerId),
  player: PlayerId,
  payload: Dynamic,
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  case decode.run(payload, move_decoder()) {
    Ok(#(x, z, facing)) -> {
      let moved = game.move(state, player, x, z)
      let turned = case facing {
        Some(f) -> game.turn(moved, player, f)
        None -> moved
      }
      let #(next, effects) = step(state, turned, env)
      #(next, list.append(effects, human_oni_effects(state, turned, player)))
    }
    Error(_) -> #(wrap(state, env), [])
  }
}

/// 通知の中身（フェーズ・鬼・エリアの色）が変わったときだけ全員へ通知する。
/// タイマーは step が進んだとき（フェーズの切り替えと、鬼選出のカウント開始）だけ張る。
fn step(
  before: Game(PlayerId),
  after: Game(PlayerId),
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  // 待機ルームのメンバーが変わっていたら、通知のタイマーを張る（issue-59）。
  let #(after, members_timer) = schedule_members(after)
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
  // いいねが変わったら、いいねの数を全員へ送る（issue-32）。
  let hiding = case after.likes == before.likes {
    True -> hiding
    False -> list.append(hiding, [driver.Broadcast(likes_payload(after))])
  }
  // 開いている襖が変わったら（開ける報告・鬼 CPU・フェーズの切り替え）、全員へ送る（issue-29b）。
  let hiding = case after.open_doors == before.open_doors {
    True -> hiding
    False ->
      list.append(hiding, [
        driver.Broadcast(stage_notice.doors_payload(after.open_doors)),
      ])
  }
  // step が進んだ（フェーズが替わった・カウントが始まった）ら、開始時刻を覚え直す。
  let env = case after.step == before.step {
    True -> env
    False -> Env(..env, started_at: env.now())
  }
  #(
    wrap(after, env),
    list.flatten([effects, hiding, finish(before, after), members_timer]),
  )
}

// --- 見逃しポイントといいね（issue-32 / ADR 0036） ------------------------------------------

fn missed_token(state: Game(PlayerId)) -> Int {
  missed_token_base - state.step
}

/// 見逃しポイントのタイマーが起きた。探索中で、張った時と同じ step なら足して、張り直す。
fn missed_woke(
  state: Game(PlayerId),
  token: Int,
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  case token == missed_token(state) && state.phase == Exploration {
    True -> {
      let #(next, effects) = step(state, game.award_missed(state), env)
      #(
        next,
        list.append(effects, [
          driver.WakeAfter(game.missed_tick_ms, missed_token(state)),
        ]),
      )
    }
    False -> #(wrap(state, env), [])
  }
}

/// 視界の報告（sight）といいね（like）。どちらでもなければ、移動の報告として読む。
fn missed_event(
  state: Game(PlayerId),
  player: PlayerId,
  payload: Dynamic,
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  case decode.run(payload, missed_events.sight_decoder()) {
    Ok(ids) ->
      step(
        state,
        game.report_sight(state, player, list.map(ids, PlayerId)),
        env,
      )
    Error(_) ->
      case decode.run(payload, missed_events.like_decoder()) {
        Ok(target) ->
          step(state, game.like(state, player, PlayerId(target)), env)
        Error(_) -> moved(state, player, payload, env)
      }
  }
}

/// いいねの数（探索の開始の時点で隠れていた隠れ側ごと。0 を含む）。
fn likes_payload(state: Game(PlayerId)) -> Dynamic {
  state.exploration_hiders
  |> list.map(fn(id) { #(id, game.likes_of(state, id)) })
  |> missed_events.likes_payload
}

/// 答え合わせ・終了の後に入り直した人へ、いいねがあれば、本人宛てで今の数を送る。
fn likes_resend(
  state: Game(PlayerId),
  player: PlayerId,
) -> List(Effect(PlayerId)) {
  case state.phase, dict.is_empty(state.likes) {
    Reveal(_), False | Ended(_), False -> [
      driver.Deliver([player], likes_payload(state)),
    ]
    _, _ -> []
  }
}

// --- 待機ルームのメンバー（issue-59 / ADR 0044） ----------------------------------------

fn members_token(state: Game(PlayerId)) -> Int {
  members_token_base - state.step
}

/// 鬼選出の間で、最後に送った内容と違い、まだタイマーを張っていなければ張る。
fn schedule_members(
  state: Game(PlayerId),
) -> #(Game(PlayerId), List(Effect(PlayerId))) {
  case
    state.phase,
    state.members_scheduled,
    game.waiting_members(state) == state.members_sent
  {
    OniSelection, False, False -> #(game.members_scheduled(state, True), [
      driver.WakeAfter(members_interval_ms, members_token(state)),
    ])
    _, _, _ -> #(state, [])
  }
}

/// メンバーの通知のタイマーが起きた。張った時と同じ step（同じフェーズ・カウントの前後が同じ）で、
/// 最後に送った内容と違えば全員へ送る。step が進んでいたら送らず、まだ鬼選出で変わっていれば
/// step を通して張り直す。
fn members_woke(
  state: Game(PlayerId),
  token: Int,
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let ready = game.members_scheduled(state, False)
  let current = game.waiting_members(ready)
  case
    token == members_token(ready)
    && ready.phase == OniSelection
    && current != ready.members_sent
  {
    True -> {
      let sent = game.members_were_sent(ready, current)
      let #(next, effects) = step(sent, sent, env)
      #(next, [driver.Broadcast(members.payload(current)), ..effects])
    }
    False -> step(ready, ready, env)
  }
}

/// 途中参加・再接続の人へ、本人宛てで今のメンバーを送る（鬼選出の間だけ）。
fn members_resend(
  state: Game(PlayerId),
  player: PlayerId,
) -> List(Effect(PlayerId)) {
  case state.phase {
    OniSelection -> [
      driver.Deliver([player], members.payload(game.waiting_members(state))),
    ]
    _ -> []
  }
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
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  let #(next, effects) = step(before, after, env)
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

/// 途中参加。変わったところ（エリアの色など）は、ふつうの通知で全員へ送る。参加した本人へのいまの状態は、
/// ルームが入室の処理の後に subscriber_snapshot で送る（ここで本人宛てを足さない。以前は「ほかに送る物が
/// 無いとき」だけ本人にフェーズを送っていたので、メンバーの通知のタイマーが出る参加では届かなかった）。
fn joined(
  before: Game(PlayerId),
  after: Game(PlayerId),
  env: Env,
) -> #(Driver(PlayerId), List(Effect(PlayerId))) {
  step(before, after, env)
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
  // 探索の開始から、0.5 秒ごとに見逃しポイントを足す（issue-32）。
  let missed = case state.phase {
    Exploration -> [driver.WakeAfter(game.missed_tick_ms, missed_token(state))]
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
  list.flatten([[notice], snapshot, timer, walking, missed])
}

// --- 電文 ----------------------------------------------------------------

/// 移動の報告 { type: "move", x, z, facing? }。数値は整数でも受け付ける。
/// facing（向き）は任意で、観戦者へ送る鬼の向きに使う（issue-28）。
/// 射撃の申告 { type: "shoot", target: playerId | null }（issue-27。契約: VeryareShootEvent）。
/// target は必須で、文字列か null。null は狙いなし（外れ）。
pub fn shoot_decoder() -> decode.Decoder(Option(PlayerId)) {
  use kind <- decode.field("type", decode.string)
  use target <- decode.field("target", decode.optional(decode.string))
  case kind {
    "shoot" -> decode.success(option.map(target, PlayerId))
    _ -> decode.failure(None, "shoot")
  }
}

fn move_decoder() -> decode.Decoder(#(Float, Float, Option(Float))) {
  use kind <- decode.field("type", decode.string)
  use x <- decode.field("x", number())
  use z <- decode.field("z", number())
  // 向きは任意。数でない値（文字列・null など）は、向きだけを捨て、位置は受け付ける（issue-59）。
  use facing <- decode.optional_field(
    "facing",
    None,
    decode.one_of(decode.map(number(), Some), [decode.success(None)]),
  )
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

/// 入室後の案内。探索時間はルーム一覧には出さず、ここで初めて伝える。広い屋敷では、骨格が決まった
/// ときに、+80 秒した探索時間で送り直す（issue-65）。
fn room_info(exploration_seconds: Int) -> Dynamic {
  dynamic.properties([
    #(dynamic.string("type"), dynamic.string("room-info")),
    #(dynamic.string("explorationSeconds"), dynamic.int(exploration_seconds)),
  ])
}

/// フェーズの開始のときのフェーズの通知（長さ = フェーズの長さ）。
fn phase_payload(state: Game(PlayerId)) -> Dynamic {
  phase_payload_after(state, 0)
}

/// フェーズの通知。全員に同じ内容を送るため、隠れ側の位置は載せない。
/// area は鬼希望エリアの色（waiting 赤 / ready 緑 / counting 青）で、鬼選出中だけ載せる。
/// durationMs は、通知を作った時点からの残り（ADR 0046）。フェーズの開始から elapsed_ms たった時点の
/// 残り（長さ − 経過。0 未満にしない）。開始のときの通知（elapsed_ms = 0）は、フェーズの長さ。
pub fn phase_payload_after(state: Game(PlayerId), elapsed_ms: Int) -> Dynamic {
  let oni = case state.oni {
    Some(PlayerId(id)) -> dynamic.string(id)
    None -> dynamic.nil()
  }
  let duration = case game.phase_duration(state) {
    Some(ms) -> dynamic.int(remaining_ms(ms, elapsed_ms))
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

/// 探索中・答え合わせ中に入り直した人へ、探索の開始に全員へ送ったのと同じ隠れ側の通知を
/// 本人宛てで送り直す（issue-29d）。ほかのフェーズと終了後は送らない。
fn hiders_resend(
  state: Game(PlayerId),
  player: PlayerId,
) -> List(Effect(PlayerId)) {
  case state.phase {
    Exploration | Reveal(_) -> [
      driver.Deliver([player], hiders_payload(state)),
      driver.Deliver([player], hiding_payload(state)),
    ]
    _ -> []
  }
}

/// 探索開始時の、まだ隠れている隠れ側全員の状態（ADR 0025 / 0035）。
/// 中身は探索の開始の時点の一覧（game.exploration_hiders）から作るので、送り直しても同じ。
/// { type: "hiders", hiders: [{ playerId, x, z, facing, pose, paint }] }。
/// 人間の隠れ側の向きは、まだ持たないので null。ポーズ（issue-56）とペイント（issue-25）は、確定した
/// ものがあれば載せ、無ければ null。
/// 隠れ CPU のペイントは全面1色で { kind: "uniform", color: "#rrggbb" }。
fn hiders_payload(state: Game(PlayerId)) -> Dynamic {
  let hiders =
    game.exploration_hider_states(state)
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
        // 人間の隠れ側: 向きはまだ持たない。ポーズ（issue-56）とペイントは、確定したものがあれば
        // 載せる（無ければ null。クライアントは既定の立ち姿で描く）。
        None -> #(
          dynamic.nil(),
          case game.pose_of(state, PlayerId(id)) {
            Some(name) -> dynamic.string(name)
            None -> dynamic.nil()
          },
          case game.paint_of(state, PlayerId(id)) {
            Some(strokes) -> paint.payload(strokes)
            None -> dynamic.nil()
          },
        )
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
/// { type: "oni", playerId, x, z, facing, pose, openDoors: [{ a: {x, z}, b: {x, z} }] }。
/// openDoors は、ゲームの襖の状態（人間・鬼 CPU が開けた襖をまとめたもの / issue-29b）。
fn oni_payload(state: Game(PlayerId)) -> Option(Dynamic) {
  let doors =
    state.open_doors |> set.to_list |> list.map(stage_notice.edge_payload)
  // 鬼 CPU は自分の状態から、人間の鬼は報告された位置と向きから作る。
  let state_of = case state.oni, state.oni_cpu {
    Some(oni), Some(walker) -> Ok(#(oni, walker.position, walker.facing, doors))
    Some(oni), None ->
      case dict.get(state.positions, oni) {
        Ok(position) ->
          Ok(#(
            oni,
            #(position.x, position.z),
            result.unwrap(dict.get(state.facings, oni), 0.0),
            doors,
          ))
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

/// 単調に増える時刻（ミリ秒）。射撃の申告を受け取った時刻に使う（撃つ間隔の判定）。
@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn now_ms() -> Int

/// 環境変数を読む（無ければ Error）。
@external(erlang, "rondo_server_ffi", "get_env")
fn get_env(name: String) -> Result(String, Nil)
