import gleam/dict
import gleam/float
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, AreaCounting, AreaReady, AreaWaiting, Ended, Exploration, HidersWin,
  NotEnoughPlayers, OniSelection, OniWins, Painting, Position, Preparation,
  Reveal, Stage, WaitingRoom,
}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/stage

// --- 補助 ---------------------------------------------------------------

const players = ["a", "b", "c", "d"]

fn new_game(ids: List(String)) -> Game(String) {
  game.new(ids, game.durations(exploration_ms: 40_000), stage.generate(0))
}

fn start() -> Game(String) {
  new_game(players)
}

/// 乱数の代わりに、常に同じ位置を返す。
fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

/// 今のフェーズのタイマーを満了させる。
fn expire(g: Game(String), pick: fn(Int) -> Int) -> Game(String) {
  game.advance(g, g.step, pick)
}

/// 鬼希望エリアに触れる（中心へ動く）。
fn touch_area(g: Game(String), id: String) -> Game(String) {
  game.move(g, id, 0.0, 0.0)
}

/// a がエリアに触れてカウントを始め、満了させて a を鬼にする（準備移動フェーズ）。
fn preparation_with_oni_a() -> Game(String) {
  start()
  |> touch_area("a")
  |> expire(always(0))
}

/// a が鬼の探索フェーズにする。
fn exploration_with_oni_a() -> Game(String) {
  preparation_with_oni_a()
  |> expire(always(0))
  |> expire(always(0))
}

fn position(g: Game(String), id: String) {
  let assert Ok(p) = dict.get(g.positions, id)
  p
}

// --- 鬼選出: トリガー式のカウントダウン ------------------------------------------

/// 開始時は鬼選出で、全員が待機ルームにいる。誰も触れていない間はカウントしない。
pub fn starts_in_oni_selection_without_countdown_test() {
  let g = start()
  g.phase |> should.equal(OniSelection)
  g.oni |> should.equal(None)
  game.phase_duration(g) |> should.equal(None)
  list.each(players, fn(id) {
    position(g, id).space |> should.equal(WaitingRoom)
  })
}

/// 2人以上いれば緑（開始）、2人未満なら赤（待機）。
pub fn area_is_ready_with_two_or_more_and_waiting_otherwise_test() {
  game.area_state(start()) |> should.equal(AreaReady)
  game.area_state(new_game(["a", "b"])) |> should.equal(AreaReady)
  game.area_state(new_game(["a"])) |> should.equal(AreaWaiting)
}

/// 最初に触れた瞬間に10秒のカウントを始め、触れた本人が立候補者になる（青）。
pub fn first_touch_starts_ten_second_countdown_test() {
  let g = start() |> touch_area("b")
  game.area_state(g) |> should.equal(AreaCounting)
  g.candidates |> should.equal(set.from_list(["b"]))
  game.phase_duration(g) |> should.equal(Some(10_000))
  g.phase |> should.equal(OniSelection)
}

/// 触れずにエリアの外を動いても、カウントは始まらない。
pub fn moving_outside_area_does_not_start_countdown_test() {
  let g = start() |> game.move("b", 1.0, 1.0)
  game.area_state(g) |> should.equal(AreaReady)
  game.phase_duration(g) |> should.equal(None)
}

/// 2人未満（赤）のときは、触れても始まらない。
pub fn touch_while_waiting_does_nothing_test() {
  let g = new_game(["a"]) |> touch_area("a")
  game.area_state(g) |> should.equal(AreaWaiting)
  g.candidates |> should.equal(set.new())
  game.phase_duration(g) |> should.equal(None)
}

/// カウント中に別の人が触れたら、立候補者に加わる。エリアに留まり続ける必要はない。
pub fn later_touches_join_candidates_even_if_they_walk_away_test() {
  let g =
    start()
    |> touch_area("b")
    |> touch_area("d")
    |> game.move("d", 1.5, 0.0)
  g.candidates |> should.equal(set.from_list(["b", "d"]))
}

/// カウント中に触れ直しても、カウントは延びない（step が変わらない）。
pub fn touching_again_does_not_restart_countdown_test() {
  let first = start() |> touch_area("b")
  let again = first |> touch_area("c")
  again.step |> should.equal(first.step)
}

/// カウントの満了で、立候補者の中から鬼を選ぶ（乱数には立候補者の人数が渡る）。
pub fn oni_is_picked_from_candidates_test() {
  let g = start() |> touch_area("b") |> touch_area("d")
  let picked =
    game.advance(g, g.step, fn(size) {
      size |> should.equal(2)
      1
    })
  picked.oni |> should.equal(Some("d"))
  picked.phase |> should.equal(Preparation)
}

/// 立候補者が全員抜けていたら、残った全員から選ぶ。
pub fn oni_is_picked_from_everyone_when_candidates_left_test() {
  let g =
    start()
    |> touch_area("b")
    |> game.leave("b")
  let picked =
    game.advance(g, g.step, fn(size) {
      size |> should.equal(3)
      2
    })
  picked.oni |> should.equal(Some("d"))
}

/// カウント中に2人未満になってもカウントは続き、満了時に2人未満なら不成立（ADR 0024）。
pub fn countdown_continues_and_fails_if_below_minimum_at_end_test() {
  let counting = new_game(["a", "b"]) |> touch_area("a") |> game.leave("b")
  game.area_state(counting) |> should.equal(AreaCounting)
  game.phase_duration(counting) |> should.equal(Some(10_000))
  expire(counting, always(0)).phase |> should.equal(Ended(NotEnoughPlayers))
}

/// 鬼選出中は入室できる。人数がそろえば赤から緑になる。
pub fn joining_during_selection_turns_waiting_into_ready_test() {
  let g = new_game(["a"])
  game.accepts_join(g) |> should.be_true
  let joined = game.join(g, "b")
  joined.players |> should.equal(["a", "b"])
  position(joined, "b").space |> should.equal(WaitingRoom)
  game.area_state(joined) |> should.equal(AreaReady)
}

/// カウント中の入室も許す（青の間は入退室を許容）。
pub fn joining_during_countdown_is_allowed_test() {
  let g = new_game(["a", "b"]) |> touch_area("a")
  game.accepts_join(g) |> should.be_true
  game.join(g, "c").players |> should.equal(["a", "b", "c"])
}

/// 鬼選出が終わったら入室できない。
pub fn joining_after_selection_is_rejected_test() {
  let g = preparation_with_oni_a()
  game.accepts_join(g) |> should.be_false
  game.join(g, "e") |> should.equal(g)
}

/// 同じ人が二重に入室しても増えない。
pub fn joining_twice_does_not_duplicate_test() {
  new_game(["a"])
  |> game.join("b")
  |> game.join("b")
  |> fn(g: Game(String)) { g.players }
  |> should.equal(["a", "b"])
}

/// カウント前のタイマーや、前のフェーズのタイマーが遅れて届いても進まない。
pub fn stale_timer_is_ignored_test() {
  let idle = start()
  game.advance(idle, idle.step, always(0)) |> should.equal(idle)

  let counting = idle |> touch_area("a")
  let prepared = expire(counting, always(0))
  game.advance(prepared, counting.step, always(0)) |> should.equal(prepared)
}

// --- フェーズ遷移 ---------------------------------------------------------------

/// 鬼選出 → 準備移動(20秒) → ペイント(20秒) → 探索（設定値）→ 答え合わせ(20秒) → 終了。
pub fn phases_advance_in_order_by_timer_test() {
  let g1 = preparation_with_oni_a()
  g1.phase |> should.equal(Preparation)
  game.phase_duration(g1) |> should.equal(Some(20_000))

  let g2 = expire(g1, always(0))
  g2.phase |> should.equal(Painting)
  game.phase_duration(g2) |> should.equal(Some(20_000))

  let g3 = expire(g2, always(0))
  g3.phase |> should.equal(Exploration)
  game.phase_duration(g3) |> should.equal(Some(40_000))

  let g4 = expire(g3, always(0))
  g4.phase |> should.equal(Reveal(HidersWin))
  game.phase_duration(g4) |> should.equal(Some(20_000))

  let g5 = expire(g4, always(0))
  g5.phase |> should.equal(Ended(HidersWin))
  game.phase_duration(g5) |> should.equal(None)
}

/// 探索フェーズの長さは作成時の設定に従う。
pub fn exploration_uses_configured_duration_test() {
  let g =
    game.new(players, game.durations(exploration_ms: 80_000), stage.generate(0))
    |> touch_area("a")
    |> expire(always(0))
    |> expire(always(0))
    |> expire(always(0))
  game.phase_duration(g) |> should.equal(Some(80_000))
}

// --- 空間（待機ルームは円柱形） -------------------------------------------------

/// 鬼が決まると、隠れ側はステージへ移り、鬼は待機ルームに残る。
pub fn hiders_move_to_stage_and_oni_stays_test() {
  let g = preparation_with_oni_a()
  position(g, "a").space |> should.equal(WaitingRoom)
  list.each(["b", "c", "d"], fn(id) {
    position(g, id).space |> should.equal(Stage)
  })
  g.still_hiding |> should.equal(set.from_list(["b", "c", "d"]))
}

/// 鬼は準備・ペイントの間は待機ルームに留まり、探索開始でステージへ移る。
pub fn oni_moves_to_stage_when_exploration_starts_test() {
  let painting = preparation_with_oni_a() |> expire(always(0))
  position(painting, "a").space |> should.equal(WaitingRoom)

  let exploring = expire(painting, always(0))
  position(exploring, "a").space |> should.equal(Stage)
}

/// 待機ルームは半径2mの円。外へ出ようとすると円の縁に丸める。
pub fn movement_is_clamped_to_circular_waiting_room_test() {
  game.waiting_room_radius |> should.equal(2.0)
  let p = start() |> game.move("a", 9.0, 0.0) |> position("a")
  p.space |> should.equal(WaitingRoom)
  { float.absolute_value(p.x -. 2.0) <. 0.0001 } |> should.be_true
  { float.absolute_value(p.z) <. 0.0001 } |> should.be_true

  // 斜めでも中心からの距離は半径以内
  let q = start() |> game.move("a", 3.0, 3.0) |> position("a")
  let distance = q.x *. q.x +. q.z *. q.z
  { distance <. 4.0001 } |> should.be_true
}

/// 円の内側なら、そのままの位置に動ける。
pub fn movement_inside_waiting_room_is_kept_test() {
  start()
  |> game.move("a", 1.0, -1.0)
  |> position("a")
  |> should.equal(Position(WaitingRoom, 1.0, -1.0))
}

// --- 移動の制限 -----------------------------------------------------------------

/// 準備中、隠れ側はステージの中を動ける。
pub fn hider_moves_on_stage_during_preparation_test() {
  let p = preparation_with_oni_a() |> game.move("b", 1.0, 2.0) |> position("b")
  p |> should.equal(Position(Stage, 1.0, 2.0))
}

/// 準備移動が終わったら、ペイント中も隠れ側は動けない。
pub fn hider_movement_is_ignored_during_painting_test() {
  let g = preparation_with_oni_a() |> expire(always(0))
  g.phase |> should.equal(Painting)
  let before = position(g, "b")
  g |> game.move("b", 4.0, 4.0) |> position("b") |> should.equal(before)
}

/// 探索フェーズ中も、隠れ側の移動入力は無視される。
pub fn hider_movement_is_ignored_during_exploration_test() {
  let g = exploration_with_oni_a()
  let before = position(g, "b")
  g |> game.move("b", 4.0, 4.0) |> position("b") |> should.equal(before)
}

/// ペイント中の鬼は待機ルームで動ける（暇つぶしペイントのため）。
pub fn oni_moves_in_waiting_room_during_painting_test() {
  preparation_with_oni_a()
  |> expire(always(0))
  |> game.move("a", 0.5, 0.5)
  |> position("a")
  |> should.equal(Position(WaitingRoom, 0.5, 0.5))
}

/// 探索フェーズ中も鬼は動ける。
pub fn oni_moves_during_exploration_test() {
  exploration_with_oni_a()
  |> game.move("a", 1.0, 1.0)
  |> position("a")
  |> should.equal(Position(Stage, 1.0, 1.0))
}

// --- まだ隠れている集合と勝敗 ----------------------------------------------------

/// 発見と切断は同じ処理を通り、結果の状態が完全に一致する（個別の分岐がない）。
pub fn found_and_left_are_handled_identically_test() {
  let g = exploration_with_oni_a()
  game.found(g, "b") |> should.equal(game.leave(g, "b"))
}

/// 最後の1人が発見でも切断でも、同じく鬼の勝利（答え合わせを経て終了）。
pub fn last_hider_found_or_left_gives_oni_the_win_test() {
  let g =
    exploration_with_oni_a()
    |> game.found("b")
    |> game.leave("c")

  let by_found = game.found(g, "d")
  let by_leave = game.leave(g, "d")
  by_found |> should.equal(by_leave)
  by_found.phase |> should.equal(Reveal(OniWins))
  expire(by_found, always(0)).phase |> should.equal(Ended(OniWins))
}

/// 準備中に隠れ側が全員切断しても鬼の勝利。答え合わせを挟む。
pub fn all_hiders_leaving_before_exploration_gives_oni_the_win_test() {
  let g =
    preparation_with_oni_a()
    |> game.leave("b")
    |> game.leave("c")
    |> game.leave("d")
  g.phase |> should.equal(Reveal(OniWins))
}

/// 鬼が猶予を過ぎて離脱すれば、即座に隠れ側の勝利（答え合わせを挟む）。
pub fn oni_leaving_gives_hiders_the_win_immediately_test() {
  preparation_with_oni_a()
  |> game.leave("a")
  |> fn(g: Game(String)) { g.phase }
  |> should.equal(Reveal(HidersWin))

  exploration_with_oni_a()
  |> game.leave("a")
  |> fn(g: Game(String)) { g.phase }
  |> should.equal(Reveal(HidersWin))
}

/// 発見は探索フェーズ中だけ有効（準備中の「発見」は無視する）。
pub fn found_outside_exploration_is_ignored_test() {
  let g = preparation_with_oni_a()
  game.found(g, "b") |> should.equal(g)
}

/// 鬼選出中の離脱は、参加者から外すだけ（勝敗は付かない）。
pub fn leaving_during_selection_just_removes_player_test() {
  let g = start() |> game.leave("b")
  g.phase |> should.equal(OniSelection)
  g.players |> should.equal(["a", "c", "d"])
}

/// 答え合わせの間は、勝敗が変わらず、移動・発見・離脱を受け付けない。
pub fn reveal_keeps_the_outcome_test() {
  let g = exploration_with_oni_a() |> expire(always(0))
  g.phase |> should.equal(Reveal(HidersWin))
  g |> game.move("a", 1.0, 1.0) |> should.equal(g)
  g |> game.found("b") |> should.equal(g)
  g |> game.leave("b") |> should.equal(g)
  g |> game.leave("a") |> should.equal(g)
}

/// 終了後は何を受けても変わらない。
pub fn ended_game_ignores_everything_test() {
  let g =
    exploration_with_oni_a()
    |> game.leave("a")
    |> expire(always(0))
  g.phase |> should.equal(Ended(HidersWin))
  g |> game.move("b", 1.0, 1.0) |> should.equal(g)
  g |> game.found("b") |> should.equal(g)
  g |> game.leave("b") |> should.equal(g)
  g |> game.join("e") |> should.equal(g)
  g |> expire(always(0)) |> should.equal(g)
  game.phase_duration(g) |> should.equal(None)
}

// --- ステージと被り判定（issue-26） -------------------------------------------

/// ゲームは開始時に選ばれたステージ（骨格と部屋の割り当て）を持つ。
pub fn game_holds_the_generated_stage_test() {
  start().layout |> should.equal(stage.generate(0))
}

/// 準備移動フェーズの終わりに、球が重なっていた隠れ側だけが失格になる。
pub fn overlapping_hiders_are_disqualified_when_preparation_ends_test() {
  let g =
    preparation_with_oni_a()
    |> game.move("b", 1.0, 1.0)
    |> game.move("c", 1.2, 1.0)
    |> game.move("d", 4.0, -4.0)
    |> expire(always(0))
  g.phase |> should.equal(Painting)
  g.still_hiding |> should.equal(set.from_list(["d"]))
}

/// 3人以上がほぼ同じ座標にいれば全員失格。全員いなくなれば鬼の勝ち（答え合わせへ）。
pub fn three_hiders_on_the_same_spot_are_all_disqualified_test() {
  let g =
    preparation_with_oni_a()
    |> game.move("b", 2.0, 2.0)
    |> game.move("c", 2.05, 2.0)
    |> game.move("d", 2.0, 1.95)
    |> expire(always(0))
  g.still_hiding |> should.equal(set.new())
  g.phase |> should.equal(Reveal(OniWins))
}

/// 失格は発見・切断と同じ処理を通る。重なった人が切断してから進んだ場合と同じ状態になる。
pub fn disqualification_uses_the_same_path_as_leaving_test() {
  let placed =
    preparation_with_oni_a()
    |> game.move("b", 1.0, 1.0)
    |> game.move("c", 1.2, 1.0)
    |> game.move("d", 4.0, -4.0)

  let by_overlap = expire(placed, always(0))
  let by_leaving =
    placed
    |> game.leave("b")
    |> game.leave("c")
    |> expire(always(0))
  by_overlap.still_hiding |> should.equal(by_leaving.still_hiding)
  by_overlap.phase |> should.equal(by_leaving.phase)
}

/// 被り判定は準備移動の終わりだけ。ペイント中に重なろうとしても動けず、失格にもならない。
pub fn overlap_is_checked_only_at_the_end_of_preparation_test() {
  let g =
    preparation_with_oni_a()
    |> expire(always(0))
    |> game.move("b", 1.0, 1.0)
    |> game.move("c", 1.0, 1.0)
    |> expire(always(0))
  g.phase |> should.equal(Exploration)
  g.still_hiding |> should.equal(set.from_list(["b", "c", "d"]))
}

/// ペイント中の移動禁止は、被り判定に使った座標をそのまま保つ（判定の前提が崩れない）。
pub fn positions_judged_for_overlap_stay_fixed_through_painting_test() {
  let prepared =
    preparation_with_oni_a()
    |> game.move("b", 1.0, 1.0)
    |> game.move("c", 3.0, 3.0)
    |> game.move("d", -3.0, 3.0)
  let painting = expire(prepared, always(0))
  let after_attempts =
    painting
    |> game.move("b", 3.0, 3.0)
    |> game.move("c", -3.0, 3.0)
    |> game.move("d", 1.0, 1.0)
  list.each(["b", "c", "d"], fn(id) {
    position(after_attempts, id) |> should.equal(position(prepared, id))
  })
  after_attempts.still_hiding |> should.equal(set.from_list(["b", "c", "d"]))
}

// --- CPU（issue-33） ---------------------------------------------------------

fn new_game_with(ids: List(String), cpus: game.Cpus(String)) -> Game(String) {
  game.new_with(
    ids,
    game.durations(exploration_ms: 40_000),
    stage.generate(0),
    cpus,
  )
}

/// CPU は参加者として、最小人数（2人）の判定に数える。1人の人間と CPU で始められる。
pub fn cpus_count_toward_the_minimum_test() {
  new_game_with(
    ["h", "cpu-1"],
    game.Cpus(hiders: ["cpu-1"], oni: None, strength: oni_cpu.Normal),
  )
  |> game.area_state
  |> should.equal(AreaReady)
  new_game_with(
    ["h", "cpu-1"],
    game.Cpus(hiders: [], oni: Some("cpu-1"), strength: oni_cpu.Normal),
  )
  |> game.area_state
  |> should.equal(AreaReady)
}

/// 隠れ側 CPU は鬼の抽選の対象にならない。立候補者が抜けて全員から引くときも同じ。
pub fn hider_cpus_are_never_picked_as_oni_test() {
  [0, 1, 2, 3]
  |> list.each(fn(index) {
    let g =
      new_game_with(
        ["cpu-1", "h", "x", "cpu-2"],
        game.Cpus(
          hiders: ["cpu-1", "cpu-2"],
          oni: None,
          strength: oni_cpu.Normal,
        ),
      )
      |> touch_area("x")
      // 立候補者 x が抜けると、残った全員からの抽選になる。
      |> game.leave("x")
      // 本物の乱数と同じく、抽選の人数の範囲で引く。
      |> expire(fn(size) { index % size })
    g.oni |> should.equal(Some("h"))
    g.still_hiding |> should.equal(set.from_list(["cpu-1", "cpu-2"]))
  })
}

/// 鬼 CPU を選ぶと、抽選をせずに CPU が鬼になり、人間は全員隠れ側になる。
pub fn oni_cpu_becomes_oni_without_a_lottery_test() {
  let g =
    new_game_with(
      ["h1", "h2", "cpu-1"],
      game.Cpus(hiders: [], oni: Some("cpu-1"), strength: oni_cpu.Normal),
    )
    |> touch_area("h1")
    |> touch_area("h2")
    |> expire(always(0))
  g.phase |> should.equal(Preparation)
  g.oni |> should.equal(Some("cpu-1"))
  g.still_hiding |> should.equal(set.from_list(["h1", "h2"]))
}

/// 鬼 CPU でも、2人未満なら不成立（人数の判定は変わらない）。
pub fn oni_cpu_still_needs_two_participants_test() {
  let g =
    new_game_with(
      ["h", "cpu-1"],
      game.Cpus(hiders: [], oni: Some("cpu-1"), strength: oni_cpu.Normal),
    )
    |> touch_area("h")
    |> game.leave("h")
    |> expire(always(0))
  g.phase |> should.equal(Ended(NotEnoughPlayers))
}

/// 隠れ CPU は準備移動の終わりに、部屋のマスへ、人間と被らずに確定する。
/// ポーズとペイント（部屋の代表色）も持ち、被りで失格にならない。
pub fn hider_cpus_settle_at_the_end_of_preparation_test() {
  let g =
    new_game_with(
      ["h", "cpu-1", "cpu-2"],
      game.Cpus(hiders: ["cpu-1", "cpu-2"], oni: None, strength: oni_cpu.Normal),
    )
    |> touch_area("h")
    |> expire(always(0))
  // h は鬼。人間の隠れ側がいないので、CPU だけが残る。
  g.oni |> should.equal(Some("h"))
  let painted = expire(g, always(0))
  painted.phase |> should.equal(Painting)
  painted.still_hiding |> should.equal(set.from_list(["cpu-1", "cpu-2"]))
  let states = game.hider_states(painted)
  list.length(states) |> should.equal(2)
  list.each(states, fn(entry) {
    let #(_id, position, placement) = entry
    position.space |> should.equal(Stage)
    let assert Some(p) = placement
    p.x |> should.equal(position.x)
    p.z |> should.equal(position.z)
  })
}

/// 人間の隠れ側の位置を避けて置く。人間の状態（ポーズ・ペイント）は未設定のまま。
pub fn hider_cpus_avoid_human_hiders_test() {
  let g =
    new_game_with(
      ["oni", "h", "cpu-1"],
      game.Cpus(hiders: ["cpu-1"], oni: None, strength: oni_cpu.Normal),
    )
    |> touch_area("oni")
    |> expire(always(0))
  g.oni |> should.equal(Some("oni"))
  let painted = expire(g, always(0))
  painted.still_hiding |> should.equal(set.from_list(["h", "cpu-1"]))
  let states = game.hider_states(painted)
  let assert Ok(#(_, human, None)) =
    list.find(states, fn(entry) { entry.0 == "h" })
  let assert Ok(#(_, cpu, Some(_))) =
    list.find(states, fn(entry) { entry.0 == "cpu-1" })
  let dx = human.x -. cpu.x
  let dz = human.z -. cpu.z
  { dx *. dx +. dz *. dz >=. 0.36 } |> should.be_true
}

/// 状態の一覧には、まだ隠れている隠れ側だけが載る（見つかった CPU は載らない）。
pub fn hider_states_list_only_those_still_hiding_test() {
  let g =
    new_game_with(
      ["oni", "cpu-1", "cpu-2"],
      game.Cpus(hiders: ["cpu-1", "cpu-2"], oni: None, strength: oni_cpu.Normal),
    )
    |> touch_area("oni")
    |> expire(always(0))
    |> expire(always(0))
    |> expire(always(0))
  g.phase |> should.equal(Exploration)
  let after = game.found(g, "cpu-1")
  game.hider_states(after)
  |> list.map(fn(entry) { entry.0 })
  |> should.equal(["cpu-2"])
}

// --- 鬼 CPU（issue-34） -------------------------------------------------------

/// 鬼 CPU と隠れ CPU だけの対戦を、探索フェーズまで進める。
fn exploration_with_oni_cpu(strength: oni_cpu.Strength) -> Game(String) {
  new_game_with(
    ["cpu-1", "cpu-2", "cpu-3"],
    game.Cpus(hiders: ["cpu-2", "cpu-3"], oni: Some("cpu-1"), strength:),
  )
  // 誰かがエリアに触れてカウントを始める（CPU は動かないので、ここでは手で触れさせる）。
  |> touch_area("cpu-2")
  |> expire(always(0))
  |> expire(always(0))
  |> expire(always(0))
}

fn ticks(g: Game(String), n: Int) -> List(Game(String)) {
  case n <= 0 {
    True -> []
    False -> {
      let next = game.tick(g)
      [next, ..ticks(next, n - 1)]
    }
  }
}

/// 鬼 CPU は、探索の開始時に玄関（リスポーン位置）から出る。
pub fn oni_cpu_starts_from_the_entrance_test() {
  let g = exploration_with_oni_cpu(oni_cpu.Normal)
  g.phase |> should.equal(Exploration)
  let #(x, z) = g.layout.skeleton.spawn
  position(g, "cpu-1") |> should.equal(Position(Stage, x, z))
  game.oni_cpu_active(g) |> should.be_true
}

/// 0.5秒ごとの tick で歩き、見つけた隠れ側は「見つけた」処理（found）と同じ経路で抜ける。
/// 全員見つければ鬼の勝ち（答え合わせへ）。「まだ隠れている」集合は増えない。
pub fn oni_cpu_finds_hiders_through_the_found_path_test() {
  let history = ticks(exploration_with_oni_cpu(oni_cpu.Strong), 400)
  list.window_by_2(history)
  |> list.each(fn(pair) {
    set.is_subset({ pair.1 }.still_hiding, { pair.0 }.still_hiding)
    |> should.be_true
  })
  let assert Ok(last) = list.last(history)
  last.phase |> should.equal(Reveal(OniWins))
  // 探索が終わった後は tick しても何も変わらない。
  game.tick(last) |> should.equal(last)
}

/// 鬼 CPU が動くと、鬼の位置が変わる。
pub fn oni_cpu_moves_on_ticks_test() {
  let g = exploration_with_oni_cpu(oni_cpu.Normal)
  let assert Ok(later) = ticks(g, 10) |> list.last
  { position(later, "cpu-1") != position(g, "cpu-1") } |> should.be_true
}

/// 鬼が人間なら、tick は何もしない。
pub fn tick_does_nothing_without_an_oni_cpu_test() {
  let g = exploration_with_oni_a()
  game.oni_cpu_active(g) |> should.be_false
  game.tick(g) |> should.equal(g)
}

/// 種が同じなら、同じ動きになる。
pub fn oni_cpu_is_deterministic_test() {
  let a = ticks(exploration_with_oni_cpu(oni_cpu.Normal), 60)
  let b = ticks(exploration_with_oni_cpu(oni_cpu.Normal), 60)
  a |> should.equal(b)
}
