//// 観戦ルームの隠れ CPU の歩き（issue-67 段階 2）を、状態機械（game）につないだもの。
////
//// - 印（with_walking_cpus）があるときだけ、準備移動の始めに、隠れ場所と道を決める
//// - 準備移動の終わりには、決めた隠れ場所に置く（被りで失格にならない）
//// - 印が無ければ、これまでどおり、準備移動の終わりに直接置く（道は決めない）

import gleam/dict
import gleam/list
import gleam/option.{Some}
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/game.{type Game, Painting, Preparation}
import rondo_server/games/veryare/hider_cpu
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/stage

const cpus = ["cpu-1", "cpu-2", "cpu-3"]

/// 鬼 CPU 1 体と、隠れ CPU 3 体（観戦ルームの既定）だけのゲーム。
fn cpu_only_game(seed: Int) -> Game(String) {
  game.new_with(
    ["oni-cpu", ..cpus],
    game.durations(exploration_ms: 40_000),
    stage.generate(seed),
    game.Cpus(hiders: cpus, oni: Some("oni-cpu"), strength: oni_cpu.Normal),
  )
}

/// 鬼選出を満了させて、準備移動へ進める（鬼 CPU が鬼になる）。
fn to_preparation(g: Game(String)) -> Game(String) {
  g
  |> game.move("oni-cpu", 0.0, 0.0)
  |> fn(g) { game.advance(g, g.step, fn(size) { 7 % size }) }
}

fn expire(g: Game(String)) -> Game(String) {
  game.advance(g, g.step, fn(size) { 3 % size })
}

/// 印があれば、準備移動の始めに、隠れ CPU 全員の道が決まり、玄関から始まる。
pub fn walking_cpus_get_walks_at_the_start_of_preparation_test() {
  list.each([0, 1, 2, 5, 9], fn(seed) {
    let g = cpu_only_game(seed) |> game.with_walking_cpus |> to_preparation
    g.phase |> should.equal(Preparation)
    g.oni |> should.equal(Some("oni-cpu"))
    list.each(cpus, fn(id) {
      let assert Ok(walk) = game.cpu_walk(g, id)
      let assert [first, ..] = walk.path
      first |> should.equal(game.spawn(g))
      {
        hider_cpu.arrival_ms(walk)
        <= hider_cpu.reach_ms(g.durations.preparation_ms)
      }
      |> should.be_true
    })
  })
}

/// 準備移動の終わりに、決めた隠れ場所へ置く。被りで失格にならず、全員が隠れたまま。
pub fn walked_cpus_settle_where_they_walked_test() {
  list.each([0, 1, 2, 5, 9], fn(seed) {
    let g = cpu_only_game(seed) |> game.with_walking_cpus |> to_preparation
    let painted = expire(g)
    painted.phase |> should.equal(Painting)
    painted.still_hiding |> should.equal(set.from_list(cpus))
    list.each(cpus, fn(id) {
      let assert Ok(walk) = game.cpu_walk(g, id)
      let assert Ok(placement) = dict.get(painted.cpu_states, id)
      placement |> should.equal(walk.placement)
    })
  })
}

/// 印が無ければ（人間の対戦）、道は決めず、これまでどおり、準備移動の終わりに直接置く。
pub fn without_the_flag_cpus_are_placed_as_before_test() {
  let g = cpu_only_game(4) |> to_preparation
  list.each(cpus, fn(id) { game.cpu_walk(g, id) |> should.equal(Error(Nil)) })
  let painted = expire(g)
  painted.phase |> should.equal(Painting)
  dict.size(painted.cpu_states) |> should.equal(3)
  g.walking_cpus |> should.be_false
}

// --- 観戦ルームの始まり方（issue-67 段階 2 の ②） -----------------------------------

/// 鬼選出を飛ばして、作った時点で準備移動から始める（鬼は鬼 CPU。隠れ CPU は歩く）。
pub fn spectating_game_starts_at_preparation_test() {
  let g =
    cpu_only_game(6)
    |> game.with_walking_cpus
    |> game.begin_without_selection(fn(size) { 2 % size })
  g.phase |> should.equal(Preparation)
  g.oni |> should.equal(Some("oni-cpu"))
  g.still_hiding |> should.equal(set.from_list(cpus))
  list.each(cpus, fn(id) { game.cpu_walk(g, id) |> should.be_ok })
}

/// 次の試合は、前の試合の step の続きから始める。前の試合のタイマー（どれも step から作る token）は、
/// 次の試合のどの step とも一致しないので、効かない。
pub fn next_game_continues_the_step_and_ignores_old_timers_test() {
  let first =
    cpu_only_game(6)
    |> game.with_walking_cpus
    |> game.begin_without_selection(fn(size) { 2 % size })
  let next =
    cpu_only_game(8)
    |> game.continue_from(first.step + 1)
    |> game.with_walking_cpus
    |> game.begin_without_selection(fn(size) { 2 % size })
  { next.step > first.step } |> should.be_true
  next.phase |> should.equal(Preparation)
  // 前の試合のフェーズのタイマー（first.step）が届いても、次の試合は進まない。
  game.advance(next, first.step, fn(size) { 0 % size }) |> should.equal(next)
}
