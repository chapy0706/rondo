//// 観戦用の通知（issue-67 段階 ③）の中身を作る純粋関数。全員の位置・向き・ポーズと、最初の 1 通に
//// 載せる、全員の色（ペイント）と隠れるときのポーズ。
////
//// - 準備移動の間、歩いている隠れ CPU は、①の position_at の位置で、進む向きを向き、ポーズは walking
//// - 着いたら（と、準備移動の後は）、隠れ場所の位置・向き・ポーズ
//// - 鬼 CPU は、ステージに出ている間（探索の開始から）だけ載る
//// - 位置と向きは、小数第 2 位までに丸める（細かい揺れで、送り直さない）

import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import rondo_server/games/veryare/game.{type Game, Exploration, Preparation}
import rondo_server/games/veryare/hider_cpu.{Placement, Walk}
import rondo_server/games/veryare/oni_cpu
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/spectate_notice.{Actor, Look}
import rondo_server/games/veryare/stage
import rondo_server/room/room_actor.{type PlayerId, PlayerId}

const pi = 3.141592653589793

fn ids(names: List(String)) -> List(PlayerId) {
  list.map(names, PlayerId)
}

/// 鬼 CPU 1 体と、隠れ CPU 3 体だけの観戦ルームの試合（準備移動から始まる）。
fn spectating(seed: Int) -> Game(PlayerId) {
  let hiders = ids(["cpu-2", "cpu-3", "cpu-4"])
  game.new_with(
    [PlayerId("cpu-1"), ..hiders],
    game.durations(exploration_ms: 40_000),
    stage.generate(seed),
    game.Cpus(hiders:, oni: Some(PlayerId("cpu-1")), strength: oni_cpu.Normal),
  )
  |> game.with_walking_cpus
  |> game.begin_without_selection(fn(size) { 2 % size })
}

fn round2(value: Float) -> Float {
  int.to_float(float.round(value *. 100.0)) /. 100.0
}

// --- 歩いている向き（hider_cpu） ----------------------------------------------------

/// 玄関から +x へ 4 m、そのあと +z へ 4 m 歩く道。
fn l_walk() {
  Walk(
    placement: Placement(
      x: 4.5,
      z: 4.5,
      facing: 1.0,
      pose: hider_cpu.Crouching,
      color: palette.unpainted,
    ),
    path: [#(0.5, 0.5), #(4.5, 0.5), #(4.5, 4.5)],
  )
}

/// 歩いている間は、いま進んでいる区間の向き。着いたら None（隠れ場所の向きを使う）。
pub fn facing_follows_the_segment_test() {
  let walk = l_walk()
  hider_cpu.facing_at(walk, 0) |> should.equal(Some(0.0))
  hider_cpu.facing_at(walk, 500) |> should.equal(Some(0.0))
  // 4 m / 4.5 m 毎秒 = 約 889 ms で角を曲がり、+z へ向く。
  hider_cpu.facing_at(walk, 1000) |> should.equal(Some(pi /. 2.0))
  hider_cpu.facing_at(walk, hider_cpu.arrival_ms(walk)) |> should.equal(None)
  hider_cpu.facing_at(walk, 60_000) |> should.equal(None)
}

/// 長さの無い道（隠れ場所が玄関）は、歩かない（いつも None）。
pub fn no_facing_without_a_path_test() {
  let walk = Walk(..l_walk(), path: [#(0.5, 0.5)])
  hider_cpu.facing_at(walk, 0) |> should.equal(None)
}

// --- 全員の位置・向き・ポーズ -------------------------------------------------------

/// 準備移動の始め（経過 0）は、隠れ CPU 全員が玄関にいて、歩いている。鬼 CPU は、まだ載らない。
pub fn preparation_starts_with_everyone_at_the_door_test() {
  list.each([0, 1, 4, 7], fn(seed) {
    let g = spectating(seed)
    g.phase |> should.equal(Preparation)
    let #(sx, sz) = game.spawn(g)
    let actors = spectate_notice.actors(g, 0)
    list.map(actors, fn(a) { a.player })
    |> should.equal(["cpu-2", "cpu-3", "cpu-4"])
    list.each(actors, fn(a) {
      a.x |> should.equal(round2(sx))
      a.z |> should.equal(round2(sz))
    })
  })
}

/// 歩いている間は、①の position_at の位置（丸めたもの）で、ポーズは walking。
pub fn walking_cpus_are_where_position_at_says_test() {
  let g = spectating(3)
  let elapsed = 700
  list.each(spectate_notice.actors(g, elapsed), fn(a) {
    let assert Ok(walk) = game.cpu_walk(g, PlayerId(a.player))
    let #(x, z) = hider_cpu.position_at(walk, elapsed)
    a.x |> should.equal(round2(x))
    a.z |> should.equal(round2(z))
    case hider_cpu.facing_at(walk, elapsed) {
      Some(facing) -> {
        a.pose |> should.equal(spectate_notice.walking_pose)
        a.facing |> should.equal(round2(facing))
      }
      None -> a.pose |> should.not_equal(spectate_notice.walking_pose)
    }
  })
}

/// 準備移動の終わり（着いた後）は、隠れ場所の位置・向き・ポーズ。
pub fn arrived_cpus_are_at_their_spots_test() {
  let g = spectating(5)
  let actors = spectate_notice.actors(g, g.durations.preparation_ms)
  list.each(actors, fn(a) {
    let assert Ok(walk) = game.cpu_walk(g, PlayerId(a.player))
    let p = walk.placement
    a
    |> should.equal(Actor(
      player: a.player,
      x: round2(p.x),
      z: round2(p.z),
      facing: round2(p.facing),
      pose: spectate_notice.pose_name(p),
    ))
  })
}

/// 探索の間は、隠れ CPU は隠れ場所に、鬼 CPU は自分の位置にいる（鬼のポーズは standing）。
pub fn exploration_adds_the_oni_test() {
  let g = spectating(2)
  let explored =
    g
    |> game.advance(g.step, fn(size) { 1 % size })
    |> fn(g) { game.advance(g, g.step, fn(size) { 1 % size }) }
  explored.phase |> should.equal(Exploration)
  let actors = spectate_notice.actors(explored, 0)
  list.map(actors, fn(a) { a.player })
  |> should.equal(["cpu-2", "cpu-3", "cpu-4", "cpu-1"])
  let assert Ok(oni) = list.last(actors)
  let assert Some(walker) = explored.oni_cpu
  oni.x |> should.equal(round2(walker.position.0))
  oni.pose |> should.equal("standing")
  list.each(list.take(actors, 3), fn(a) {
    let assert Ok(p) = dict.get(explored.cpu_states, PlayerId(a.player))
    a.x |> should.equal(round2(p.x))
    a.pose |> should.equal(spectate_notice.pose_name(p))
  })
}

// --- 色とポーズ（最初の 1 通） -------------------------------------------------------

/// 色（全面 1 色）と、隠れるときのポーズ。準備移動の間から分かる（歩く道を決めたときに決まる）。
pub fn looks_are_known_from_the_start_test() {
  let g = spectating(6)
  let looks = spectate_notice.looks(g)
  list.map(looks, fn(l) { l.player })
  |> should.equal(["cpu-2", "cpu-3", "cpu-4"])
  list.each(looks, fn(l) {
    let assert Ok(walk) = game.cpu_walk(g, PlayerId(l.player))
    l
    |> should.equal(Look(
      player: l.player,
      pose: spectate_notice.pose_name(walk.placement),
      color: palette.to_hex(walk.placement.color),
    ))
  })
}

// --- 電文の形 ----------------------------------------------------------------------

fn field(payload: Dynamic, path: List(String), decoder) {
  decode.run(payload, decode.at(path, decoder))
}

/// { type: "spectate", actors: [{ playerId, x, z, facing, pose }] }。looks は、渡したときだけ載る。
pub fn payload_shape_test() {
  let actors = [Actor("cpu-2", 1.25, 2.5, 0.5, "walking")]
  let plain = spectate_notice.payload(actors, None)
  field(plain, ["type"], decode.string) |> should.equal(Ok("spectate"))
  field(
    plain,
    ["actors"],
    decode.list({
      use id <- decode.field("playerId", decode.string)
      use x <- decode.field("x", decode.float)
      use z <- decode.field("z", decode.float)
      use facing <- decode.field("facing", decode.float)
      use pose <- decode.field("pose", decode.string)
      decode.success(Actor(id, x, z, facing, pose))
    }),
  )
  |> should.equal(Ok(actors))
  field(plain, ["looks"], decode.dynamic) |> should.be_error

  let full =
    spectate_notice.payload(actors, Some([Look("cpu-2", "lying", "#aabbcc")]))
  field(
    full,
    ["looks"],
    decode.list({
      use id <- decode.field("playerId", decode.string)
      use pose <- decode.field("pose", decode.string)
      use kind <- decode.subfield(["paint", "kind"], decode.string)
      use color <- decode.subfield(["paint", "color"], decode.string)
      decode.success(#(id, pose, kind, color))
    }),
  )
  |> should.equal(Ok([#("cpu-2", "lying", "uniform", "#aabbcc")]))
}

/// 位置と向きは、小数第 2 位までに丸める。
pub fn positions_are_rounded_test() {
  spectate_notice.round(1.23456) |> should.equal(1.23)
  spectate_notice.round(-0.0051) |> should.equal(-0.01)
  spectate_notice.round(2.0) |> should.equal(2.0)
}
