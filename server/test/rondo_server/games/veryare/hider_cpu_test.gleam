import gleam/dict
import gleam/float
import gleam/int
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/hider_cpu.{
  type Placement, Crouching, Lying, Standing,
}
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/stage.{type Layout, Cell}

// --- 補助 ---------------------------------------------------------------

/// 置いたマスと、そのマスが入っている部屋のタイプ。
fn room_at(layout: Layout, p: Placement) -> Result(stage.RoomType, Nil) {
  let cell = Cell(float.truncate(p.x), float.truncate(p.z))
  layout.skeleton.slots
  |> list.find(fn(slot) { list.contains(slot.cells, cell) })
  |> fn(found) {
    case found {
      Ok(slot) -> dict.get(layout.rooms, slot.id)
      Error(Nil) -> Error(Nil)
    }
  }
}

fn as_bodies(placements: List(Placement)) -> List(#(Int, Float, Float)) {
  list.index_map(placements, fn(p, i) { #(i, p.x, p.z) })
}

/// from から to まで（両端を含む）の種。
fn seeds(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..seeds(from + 1, to)]
  }
}

// --- 配置 ----------------------------------------------------------------

/// 頼んだ数だけ、部屋が割り当てられたスロットのマスの中心に置く。
pub fn places_cpus_at_the_center_of_room_cells_test() {
  seeds(0, 19)
  |> list.each(fn(seed) {
    let layout = stage.generate(seed)
    let placed = hider_cpu.place(layout, [], 3, seed)
    list.length(placed) |> should.equal(3)
    list.each(placed, fn(p) {
      // マスの中心（x.5, z.5）。
      { p.x -. int.to_float(float.truncate(p.x)) } |> should.equal(0.5)
      { p.z -. int.to_float(float.truncate(p.z)) } |> should.equal(0.5)
      room_at(layout, p) |> should.be_ok
    })
  })
}

/// CPU どうしも、すでにいる隠れ側とも被らない。
pub fn cpus_do_not_overlap_each_other_or_existing_hiders_test() {
  seeds(0, 19)
  |> list.each(fn(seed) {
    let layout = stage.generate(seed)
    // 先に、CPU が選びそうな部屋のマスに人間を立たせておく。
    let first = hider_cpu.place(layout, [], 3, seed)
    let occupied = list.map(first, fn(p) { #(p.x +. 0.1, p.z) })
    let placed = hider_cpu.place(layout, occupied, 3, seed)
    let bodies =
      list.flatten([
        as_bodies(placed),
        list.index_map(occupied, fn(o, i) { #(100 + i, o.0, o.1) }),
      ])
    overlap.overlapping(bodies) |> should.equal(set.new())
  })
}

/// ペイントは、置いた部屋のタイプの代表色で全面を1色に塗る。
pub fn paint_is_the_room_color_test() {
  let layout = stage.generate(5)
  hider_cpu.place(layout, [], 3, 5)
  |> list.each(fn(p) {
    let assert Ok(room) = room_at(layout, p)
    p.color |> should.equal(palette.room_color(room))
  })
}

/// ポーズは 立ち・しゃがみ・寝そべり から選び、向きは 0 以上 2π 未満。
pub fn pose_and_facing_are_chosen_at_random_test() {
  let poses =
    seeds(0, 39)
    |> list.flat_map(fn(seed) {
      hider_cpu.place(stage.generate(seed), [], 3, seed)
    })
    |> list.map(fn(p) {
      { p.facing >=. 0.0 && p.facing <. 6.2832 } |> should.be_true
      p.pose
    })
    |> set.from_list
  poses |> should.equal(set.from_list([Standing, Crouching, Lying]))
}

/// 同じ種なら同じ配置、違う種なら（たいてい）違う配置。
pub fn same_seed_gives_same_placement_test() {
  let layout = stage.generate(3)
  hider_cpu.place(layout, [], 3, 42)
  |> should.equal(hider_cpu.place(layout, [], 3, 42))
  let others =
    seeds(43, 52)
    |> list.map(fn(seed) { hider_cpu.place(layout, [], 3, seed) })
    |> set.from_list
  { set.size(others) > 1 } |> should.be_true
}

/// 0 体なら何も置かない。
pub fn zero_cpus_places_nothing_test() {
  hider_cpu.place(stage.generate(1), [], 0, 1) |> should.equal([])
}
