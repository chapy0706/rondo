import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/stage.{
  type Layout, type Skeleton, Cell, Large, Oshiire, Small, Washitsu,
  WashitsuWithKakejiku, WashitsuWithOshiire,
}

/// 検算に使う生成結果の数。種を変えて何度も割り当てる。
const runs = 300

fn layouts() -> List(Layout) {
  list.repeat(Nil, runs)
  |> list.index_map(fn(_, seed) { stage.generate(seed) })
}

fn each_skeleton(check: fn(Skeleton) -> Nil) -> Nil {
  list.each(stage.skeletons(), check)
}

// --- 骨格データ（段階 1 / 3） -----------------------------------------------

/// 骨格は10種類ある。
pub fn there_are_ten_skeletons_test() {
  stage.skeletons() |> list.length |> should.equal(10)
}

/// 大スロットは 4m x 6m、小スロットは 2m x 1m の長方形（向きは問わない）。
pub fn slots_have_the_expected_sizes_test() {
  each_skeleton(fn(skeleton) {
    list.each(skeleton.slots, fn(slot) {
      let xs = list.map(slot.cells, fn(c) { c.x })
      let zs = list.map(slot.cells, fn(c) { c.z })
      let assert Ok(min_x) = list.reduce(xs, int.min)
      let assert Ok(max_x) = list.reduce(xs, int.max)
      let assert Ok(min_z) = list.reduce(zs, int.min)
      let assert Ok(max_z) = list.reduce(zs, int.max)
      let w = max_x - min_x + 1
      let d = max_z - min_z + 1
      // 欠けのない長方形
      list.length(slot.cells) |> should.equal(w * d)
      let dims = list.sort([w, d], int.compare)
      case slot.size {
        Large -> dims |> should.equal([4, 6])
        Small -> dims |> should.equal([1, 2])
      }
    })
  })
}

/// どのスロットも廊下に面している（襖の相手が廊下のマス）。
pub fn every_slot_faces_the_corridor_test() {
  each_skeleton(fn(skeleton) {
    let corridor = set.from_list(skeleton.corridor)
    list.each(skeleton.slots, fn(slot) {
      list.each(slot.doors, fn(door) {
        set.contains(corridor, door.corridor) |> should.be_true
        list.contains(slot.cells, door.slot) |> should.be_true
        stage.adjacent(door.corridor, door.slot) |> should.be_true
      })
      { slot.doors != [] } |> should.be_true
    })
  })
}

/// 各スロットの出入り口（襖）は1つだけ。
pub fn every_slot_has_exactly_one_door_test() {
  each_skeleton(fn(skeleton) {
    list.each(skeleton.slots, fn(slot) {
      list.length(slot.doors) |> should.equal(1)
    })
  })
}

/// 部屋同士を直接つなぐ襖はない。襖のマスはどれも、ちょうど1つのスロットにだけ接する。
pub fn no_door_connects_two_slots_test() {
  each_skeleton(fn(skeleton) {
    let door_cells =
      list.flat_map(skeleton.slots, fn(slot) {
        list.map(slot.doors, fn(door) { door.corridor })
      })
    // 同じ襖のマスが2つのスロットの襖として数えられていない
    set.size(set.from_list(door_cells)) |> should.equal(list.length(door_cells))
    // 襖はスロットのマスには無い（スロットとスロットの間に襖はない）
    let slot_cells =
      set.from_list(list.flat_map(skeleton.slots, fn(slot) { slot.cells }))
    list.each(door_cells, fn(cell) {
      set.contains(slot_cells, cell) |> should.be_false
    })
  })
}

/// 廊下・縁側・玄関はすべてつながっている（廊下経由でどのスロットにも行ける）。
pub fn walkable_area_is_connected_test() {
  each_skeleton(fn(skeleton) {
    stage.is_connected(skeleton.walkable) |> should.be_true
  })
}

/// 縁側・玄関はそれぞれ1箇所（ひとつながり）。
pub fn one_engawa_and_one_entrance_test() {
  each_skeleton(fn(skeleton) {
    { skeleton.engawa != [] } |> should.be_true
    { skeleton.entrance != [] } |> should.be_true
    stage.is_connected(skeleton.engawa) |> should.be_true
    stage.is_connected(skeleton.entrance) |> should.be_true
  })
}

/// 縁側の外周（庭側）には、出られない境界の印（見えない壁）がある。
pub fn engawa_has_invisible_walls_toward_the_garden_test() {
  each_skeleton(fn(skeleton) {
    { skeleton.invisible_walls != [] } |> should.be_true
    list.each(skeleton.invisible_walls, fn(wall) {
      list.contains(skeleton.engawa, wall.inside) |> should.be_true
      list.contains(skeleton.walkable, wall.outside) |> should.be_false
      stage.adjacent(wall.inside, wall.outside) |> should.be_true
    })
  })
}

/// 玄関の中心が、鬼と隠れ側の初期リスポーン位置として記録されている。
pub fn spawn_is_inside_the_entrance_test() {
  each_skeleton(fn(skeleton) {
    let #(x, z) = skeleton.spawn
    list.contains(skeleton.entrance, Cell(float.truncate(x), float.truncate(z)))
    |> should.be_true
  })
}

// --- 割り当て（段階 2） --------------------------------------------------------

/// 大スロットには和室系、小スロットには押し入れ単体だけが割り当てられる（空きも可）。
pub fn room_types_match_slot_sizes_test() {
  list.each(layouts(), fn(layout) {
    list.each(layout.skeleton.slots, fn(slot) {
      case slot.size, dict.get(layout.rooms, slot.id) {
        Large, Ok(room) ->
          list.contains(
            [Washitsu, WashitsuWithOshiire, WashitsuWithKakejiku],
            room,
          )
          |> should.be_true
        Small, Ok(room) -> room |> should.equal(Oshiire)
        _, Error(Nil) -> Nil
      }
    })
    // 骨格に無いスロットへは割り当てない
    list.each(dict.keys(layout.rooms), fn(id) {
      list.any(layout.skeleton.slots, fn(slot) { slot.id == id })
      |> should.be_true
    })
  })
}

/// 毎回の割り当てが、和室8〜12・押し入れ（部屋内包＋独立）3〜5 に収まる。
pub fn every_layout_matches_the_room_composition_test() {
  list.each(layouts(), fn(layout) {
    let washitsu = stage.washitsu_count(layout)
    let oshiire = stage.oshiire_count(layout)
    { washitsu >= 8 && washitsu <= 12 } |> should.be_true
    { oshiire >= 3 && oshiire <= 5 } |> should.be_true
  })
}

/// どの骨格でも、構成に沿った割り当てができる（10種すべてが一度は選ばれ、条件を満たす）。
pub fn every_skeleton_is_chosen_and_valid_test() {
  let chosen =
    layouts()
    |> list.map(fn(layout) { layout.skeleton.id })
    |> set.from_list
  set.size(chosen) |> should.equal(10)
}

/// 玄関の位置は骨格ごとに固定。割り当てが変わっても玄関とリスポーン位置は変わらない。
pub fn entrance_is_fixed_per_skeleton_test() {
  let by_skeleton =
    layouts()
    |> list.group(fn(layout) { layout.skeleton.id })
  dict.each(by_skeleton, fn(_id, group) {
    let entrances =
      group
      |> list.map(fn(layout) {
        #(layout.skeleton.entrance, layout.skeleton.spawn)
      })
      |> set.from_list
    set.size(entrances) |> should.equal(1)
  })
}

/// 骨格の選択と部屋の割り当ては、実行のたびに変わりうる（空きスロットも生じる）。
pub fn selection_and_assignment_vary_between_runs_test() {
  let all = layouts()
  // 同じ骨格でも、割り当てが違う回がある
  let assignments =
    all
    |> list.map(fn(layout) { #(layout.skeleton.id, layout.rooms) })
    |> set.from_list
  { set.size(assignments) > 10 } |> should.be_true
  // 空きスロットが生じる回がある
  list.any(all, fn(layout) {
    dict.size(layout.rooms) < list.length(layout.skeleton.slots)
  })
  |> should.be_true
  // 3種類の和室と、独立した押し入れがそれぞれ現れる
  let kinds =
    all
    |> list.flat_map(fn(layout) { dict.values(layout.rooms) })
    |> set.from_list
  kinds
  |> should.equal(
    set.from_list([Washitsu, WashitsuWithOshiire, WashitsuWithKakejiku, Oshiire]),
  )
}

/// 同じ種なら同じ結果（テストや再現のため）。
pub fn same_seed_gives_same_layout_test() {
  stage.generate(42) |> should.equal(stage.generate(42))
}
