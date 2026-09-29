import gleam/dict
import gleam/list
import gleam/option.{None, Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{
  type Game, Ended, Exploration, HidersWin, NotEnoughPlayers, OniSelection,
  OniWins, Painting, Position, Preparation, Stage, WaitingRoom,
}

// --- 補助 ---------------------------------------------------------------

const players = ["a", "b", "c", "d"]

fn start() -> Game(String) {
  game.new(players, game.durations(exploration_ms: 40_000))
}

/// 乱数の代わりに、常に同じ位置を返す。
fn always(index: Int) -> fn(Int) -> Int {
  fn(_size) { index }
}

/// 今のフェーズのタイマーを満了させる。
fn expire(g: Game(String), pick: fn(Int) -> Int) -> Game(String) {
  game.advance(g, g.step, pick)
}

/// 鬼選出を終え、a が鬼の準備移動フェーズにする。
fn preparation_with_oni_a() -> Game(String) {
  start()
  |> game.move("a", 0.0, 0.0)
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

// --- フェーズ遷移（段階 2 / 5） -------------------------------------------

/// 開始時は鬼選出で、全員が待機ルームにいる。鬼選出は10秒。
pub fn starts_in_oni_selection_in_waiting_room_test() {
  let g = start()
  g.phase |> should.equal(OniSelection)
  g.oni |> should.equal(None)
  game.phase_duration(g) |> should.equal(Some(10_000))
  list.each(players, fn(id) {
    position(g, id).space |> should.equal(WaitingRoom)
  })
}

/// 鬼選出 → 準備移動(20秒) → ペイント(20秒) → 探索（設定値）の順に、時間経過で進む。
pub fn phases_advance_in_order_by_timer_test() {
  let g0 = start()
  let g1 = expire(g0, always(0))
  g1.phase |> should.equal(Preparation)
  game.phase_duration(g1) |> should.equal(Some(20_000))

  let g2 = expire(g1, always(0))
  g2.phase |> should.equal(Painting)
  game.phase_duration(g2) |> should.equal(Some(20_000))

  let g3 = expire(g2, always(0))
  g3.phase |> should.equal(Exploration)
  game.phase_duration(g3) |> should.equal(Some(40_000))
}

/// 探索フェーズの長さは作成時の設定に従う。
pub fn exploration_uses_configured_duration_test() {
  let g =
    game.new(players, game.durations(exploration_ms: 80_000))
    |> expire(always(0))
    |> expire(always(0))
    |> expire(always(0))
  game.phase_duration(g) |> should.equal(Some(80_000))
}

/// 前のフェーズのタイマー（古い step）が遅れて届いても、進まない。
pub fn stale_timer_is_ignored_test() {
  let g0 = start()
  let g1 = expire(g0, always(0))
  game.advance(g1, g0.step, always(0)) |> should.equal(g1)
}

// --- 鬼選出（段階 3 / 4） ------------------------------------------------

/// 最初は誰も鬼希望エリアにいない（立ち位置はエリアの外）。
pub fn nobody_is_candidate_at_start_test() {
  game.candidates(start()) |> should.equal([])
}

/// 鬼希望エリアに入ったプレイヤーが立候補者になり、その中から選ばれる。
pub fn oni_is_picked_from_candidates_test() {
  let g =
    start()
    |> game.move("b", 0.1, 0.0)
    |> game.move("d", 0.0, -0.2)
  game.candidates(g) |> should.equal(["b", "d"])

  // 乱数には立候補者の人数が渡り、返った位置の立候補者が鬼になる。
  let picked =
    game.advance(g, g.step, fn(size) {
      size |> should.equal(2)
      1
    })
  picked.oni |> should.equal(Some("d"))
}

/// 立候補者がいなければ、全員の中から選ばれる。
pub fn oni_is_picked_from_everyone_without_candidates_test() {
  let g =
    game.advance(start(), 0, fn(size) {
      size |> should.equal(4)
      2
    })
  g.oni |> should.equal(Some("c"))
}

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

/// 鬼選出の時点で2人未満なら、ゲームは成立しない。
pub fn selection_with_single_player_does_not_start_test() {
  let g =
    game.new(["a", "b"], game.durations(exploration_ms: 40_000))
    |> game.leave("b")
    |> expire(always(0))
  g.phase |> should.equal(Ended(NotEnoughPlayers))
}

// --- 移動（段階 10 のサーバー側） -----------------------------------------

/// 待機ルームの外へは出られない（部屋の範囲に丸める）。
pub fn movement_is_clamped_to_waiting_room_test() {
  let p = start() |> game.move("a", 9.0, -9.0) |> position("a")
  p
  |> should.equal(Position(
    WaitingRoom,
    game.waiting_room_half,
    0.0 -. game.waiting_room_half,
  ))
}

/// 準備中、隠れ側はステージの中を動ける。
pub fn hider_moves_on_stage_during_preparation_test() {
  let p = preparation_with_oni_a() |> game.move("b", 1.0, 2.0) |> position("b")
  p |> should.equal(Position(Stage, 1.0, 2.0))
}

/// 探索フェーズ中、隠れ側の移動入力は無視され、位置が変わらない。
pub fn hider_movement_is_ignored_during_exploration_test() {
  let g = exploration_with_oni_a()
  let before = position(g, "b")
  g |> game.move("b", 4.0, 4.0) |> position("b") |> should.equal(before)
}

/// 探索フェーズ中も鬼は動ける。
pub fn oni_moves_during_exploration_test() {
  exploration_with_oni_a()
  |> game.move("a", 1.0, 1.0)
  |> position("a")
  |> should.equal(Position(Stage, 1.0, 1.0))
}

// --- まだ隠れている集合と勝敗（段階 7 / 8） -----------------------------------

/// 発見と切断は同じ処理を通り、結果の状態が完全に一致する（個別の分岐がない）。
pub fn found_and_left_are_handled_identically_test() {
  let g = exploration_with_oni_a()
  game.found(g, "b") |> should.equal(game.leave(g, "b"))
}

/// 最後の1人が発見でも切断でも、同じく鬼の勝利になる。
pub fn last_hider_found_or_left_gives_oni_the_win_test() {
  let g =
    exploration_with_oni_a()
    |> game.found("b")
    |> game.leave("c")

  let by_found = game.found(g, "d")
  let by_leave = game.leave(g, "d")
  by_found |> should.equal(by_leave)
  by_found.phase |> should.equal(Ended(OniWins))
}

/// 準備中に隠れ側が全員切断しても、集合が0人になった時点で鬼の勝利。
pub fn all_hiders_leaving_before_exploration_gives_oni_the_win_test() {
  let g =
    preparation_with_oni_a()
    |> game.leave("b")
    |> game.leave("c")
    |> game.leave("d")
  g.phase |> should.equal(Ended(OniWins))
}

/// 探索の時間切れで1人以上残っていれば、隠れ側の勝利。
pub fn exploration_timeout_with_hiders_left_gives_hiders_the_win_test() {
  let g =
    exploration_with_oni_a()
    |> game.found("b")
    |> expire(always(0))
  g.phase |> should.equal(Ended(HidersWin))
}

/// 鬼が猶予を過ぎて離脱（Leave が届く）すれば、即座に隠れ側の勝利。
pub fn oni_leaving_gives_hiders_the_win_immediately_test() {
  preparation_with_oni_a()
  |> game.leave("a")
  |> fn(g: Game(String)) { g.phase }
  |> should.equal(Ended(HidersWin))

  exploration_with_oni_a()
  |> game.leave("a")
  |> fn(g: Game(String)) { g.phase }
  |> should.equal(Ended(HidersWin))
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

/// 終了後は何を受けても変わらない。
pub fn ended_game_ignores_everything_test() {
  let g = exploration_with_oni_a() |> game.leave("a")
  g |> game.move("b", 1.0, 1.0) |> should.equal(g)
  g |> game.found("b") |> should.equal(g)
  g |> game.leave("b") |> should.equal(g)
  g |> expire(always(0)) |> should.equal(g)
  game.phase_duration(g) |> should.equal(None)
}
