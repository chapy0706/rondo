import gleam/dict
import gleam/int
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/oni_cpu.{
  type OniCpu, Hider, Normal, Params, Strong, Weak,
}
import rondo_server/games/veryare/palette.{Rgb}
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage

// --- 補助 ---------------------------------------------------------------

fn seeds(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..seeds(from + 1, to)]
  }
}

/// n 歩進め、各歩の前後の状態を集める（隠れ側なし）。
fn run(cpu: OniCpu, map: sight.Map, layout, n: Int) -> List(#(OniCpu, OniCpu)) {
  case n <= 0 {
    True -> []
    False -> {
      let #(next, _, _) = oni_cpu.step(cpu, map, layout, [])
      [#(cpu, next), ..run(next, map, layout, n - 1)]
    }
  }
}

fn center_of(cell: stage.Cell) -> #(Float, Float) {
  #(int.to_float(cell.x) +. 0.5, int.to_float(cell.z) +. 0.5)
}

// --- 出発と移動 --------------------------------------------------------------

/// 玄関（リスポーン位置）から、襖をすべて閉じた状態で出発する。
pub fn starts_at_the_entrance_with_all_doors_closed_test() {
  let layout = stage.generate(1)
  let cpu = oni_cpu.start(layout, Normal, 1)
  cpu.position |> should.equal(layout.skeleton.spawn)
  cpu.open_doors |> should.equal(set.new())
}

/// 1歩ごとに隣のマスへしか進まず、襖を越えるときは先に開けている。開けた襖は閉じない。
pub fn moves_cell_by_cell_and_opens_doors_before_passing_test() {
  list.each(seeds(0, 9), fn(seed) {
    let layout = stage.generate(seed)
    let map = sight.map_of(layout)
    run(oni_cpu.start(layout, Strong, seed), map, layout, 300)
    |> list.each(fn(pair) {
      let #(before, after) = pair
      // 開けた襖は減らない。
      set.is_subset(before.open_doors, after.open_doors) |> should.be_true
      // 通った道筋の隣り合うマスは、開いた襖か同じ領域でつながっている。
      list.window_by_2([before.cell, ..after.trail])
      |> list.each(fn(step) {
        stage.adjacent(step.0, step.1) |> should.be_true
        sight.passable(map, after.open_doors, step.0, step.1) |> should.be_true
      })
      // 1歩で進むマス数は、歩く速さの上限まで。
      { list.length(after.trail) <= 2 } |> should.be_true
    })
  })
}

/// 襖を順に巡る（しばらく歩くと、いくつもの襖を開け、いくつもの部屋に入る）。
pub fn visits_rooms_through_their_doors_test() {
  list.each(seeds(0, 9), fn(seed) {
    let layout = stage.generate(seed)
    let map = sight.map_of(layout)
    let steps = run(oni_cpu.start(layout, Normal, seed), map, layout, 160)
    let assert Ok(#(_, last)) = list.last(steps)
    { set.size(last.open_doors) >= 3 } |> should.be_true
    // 立ち入った部屋（スロット）の数。
    let entered =
      steps
      |> list.flat_map(fn(pair) { { pair.1 }.trail })
      |> list.filter_map(fn(cell) {
        list.find(layout.skeleton.slots, fn(slot) {
          list.contains(slot.cells, cell)
        })
      })
      |> list.map(fn(slot) { slot.id })
      |> set.from_list
    { set.size(entered) >= 3 } |> should.be_true
  })
}

/// 種を固定すれば、同じ動きになる。
pub fn same_seed_gives_the_same_walk_test() {
  let layout = stage.generate(4)
  let map = sight.map_of(layout)
  let walk = fn(seed) {
    run(oni_cpu.start(layout, Normal, seed), map, layout, 80)
    |> list.map(fn(pair) { #({ pair.1 }.cell, { pair.1 }.facing) })
  }
  walk(7) |> should.equal(walk(7))
  { walk(7) != walk(8) } |> should.be_true
}

// --- 視界と発見 --------------------------------------------------------------

/// 視野角と視距離は、強さごとの範囲の中で乱数で決まる。
pub fn view_is_drawn_within_the_preset_ranges_test() {
  list.each([Weak, Normal, Strong], fn(strength) {
    let p = oni_cpu.params(strength)
    list.each(seeds(0, 19), fn(seed) {
      let cpu = oni_cpu.start(stage.generate(seed), strength, seed)
      { cpu.view.fov >=. p.fov_min && cpu.view.fov <=. p.fov_max }
      |> should.be_true
      { cpu.view.range >=. p.range_min && cpu.view.range <=. p.range_max }
      |> should.be_true
    })
  })
}

/// 強さの順に、歩く速さ・視野・視距離・発見確率が下がらない。
pub fn presets_are_ordered_by_strength_test() {
  let w = oni_cpu.params(Weak)
  let n = oni_cpu.params(Normal)
  let s = oni_cpu.params(Strong)
  [#(w, n), #(n, s)]
  |> list.each(fn(pair) {
    let #(a, b) = pair
    { a.speed <=. b.speed } |> should.be_true
    { a.fov_max <=. b.fov_max } |> should.be_true
    { a.range_max <=. b.range_max } |> should.be_true
    { a.base_chance <=. b.base_chance } |> should.be_true
    { a.wander >=. b.wander } |> should.be_true
  })
}

/// 発見確率は、近いほど高く、溶け込んでいるほど低い。下限より下がらない（0 にならない）。
pub fn find_chance_depends_on_distance_and_blending_test() {
  let p = oni_cpu.params(Normal)
  let view = sight.View(fov: 1.5, range: 8.0)
  let near = oni_cpu.find_chance(p, view, 1.0, 0.0)
  let far = oni_cpu.find_chance(p, view, 7.0, 0.0)
  let blended = oni_cpu.find_chance(p, view, 1.0, 1.0)
  { near >. far } |> should.be_true
  { near >. blended } |> should.be_true
  { blended >=. p.min_chance } |> should.be_true
  { oni_cpu.find_chance(p, view, 8.0, 1.0) >=. p.min_chance } |> should.be_true
  { p.min_chance >. 0.0 } |> should.be_true
}

/// 壁や閉じた襖の向こうの隠れ側は、確率が 1 でも見つけない。
/// 見つけた隠れ側は、その瞬間に必ず見通せている。
pub fn never_finds_hiders_it_cannot_see_test() {
  let sure = Params(..oni_cpu.params(Strong), base_chance: 1.0, min_chance: 1.0)
  list.each(seeds(0, 9), fn(seed) {
    let layout = stage.generate(seed)
    let map = sight.map_of(layout)
    // すべての部屋の、すべてのマスに隠れ側を置く（部屋の代表色で塗った CPU）。
    let hiders =
      layout.skeleton.slots
      |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
      |> list.flat_map(fn(slot) { slot.cells })
      |> list.index_map(fn(cell, i) {
        let #(x, z) = center_of(cell)
        Hider(id: i, x:, z:, color: Rgb(0, 0, 0))
      })
    check_walk(oni_cpu.start_with(layout, sure, seed), map, layout, hiders, 200)
  })
}

fn check_walk(cpu, map, layout, hiders: List(oni_cpu.Hider(Int)), n: Int) {
  case n <= 0 {
    True -> Nil
    False -> {
      let #(next, found, seen) = oni_cpu.step(cpu, map, layout, hiders)
      list.each(found, fn(id) {
        list.contains(seen, id) |> should.be_true
        let assert Ok(h) = list.find(hiders, fn(h) { h.id == id })
        sight.can_see(
          map,
          next.open_doors,
          next.position,
          next.facing,
          next.view,
          #(h.x, h.z),
        )
        |> should.be_true
      })
      let remaining = list.filter(hiders, fn(h) { !list.contains(found, h.id) })
      check_walk(next, map, layout, remaining, n - 1)
    }
  }
}

/// 視界に入った隠れ側は、確率が 1 なら見つける（見つけられる場面がある）。
pub fn finds_visible_hiders_test() {
  let sure = Params(..oni_cpu.params(Strong), base_chance: 1.0, min_chance: 1.0)
  let layout = stage.generate(2)
  let map = sight.map_of(layout)
  let hiders =
    layout.skeleton.slots
    |> list.filter(fn(slot) { dict.has_key(layout.rooms, slot.id) })
    |> list.flat_map(fn(slot) { slot.cells })
    |> list.index_map(fn(cell, i) {
      let #(x, z) = center_of(cell)
      Hider(id: i, x:, z:, color: Rgb(0, 0, 0))
    })
  let total =
    count_found(
      oni_cpu.start_with(layout, sure, 2),
      map,
      layout,
      hiders,
      200,
      0,
    )
  { total > 0 } |> should.be_true
}

fn count_found(cpu, map, layout, hiders: List(oni_cpu.Hider(Int)), n, acc) {
  case n <= 0 {
    True -> acc
    False -> {
      let #(next, found, _) = oni_cpu.step(cpu, map, layout, hiders)
      let remaining = list.filter(hiders, fn(h) { !list.contains(found, h.id) })
      count_found(next, map, layout, remaining, n - 1, acc + list.length(found))
    }
  }
}

/// 向きはラジアンで、-π〜π に収まる。
pub fn facing_is_normalized_test() {
  let layout = stage.generate(3)
  let map = sight.map_of(layout)
  run(oni_cpu.start(layout, Normal, 3), map, layout, 60)
  |> list.each(fn(pair) {
    let f = { pair.1 }.facing
    { f >=. 0.0 -. 3.1416 && f <=. 3.1416 } |> should.be_true
  })
}
