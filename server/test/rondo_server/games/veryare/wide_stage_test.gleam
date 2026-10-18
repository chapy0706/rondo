//// 広い屋敷の抽選と割り当て（issue-65 段階 4 / ADR 0048）。stage.generate と RandomLayout（ふつうだけ）は
//// 変えず、2 段の抽選（generate_mixed）と、広い屋敷だけ（generate_wide）を足す。

import gleam/dict
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/games/veryare/stage.{Large, Oshiire, Small}
import rondo_server/games/veryare/wide_skeleton_maps

const draws = 4000

fn seeds(count: Int) -> List(Int) {
  list.index_map(list.repeat(Nil, count), fn(_, i) { i * 7919 + 13 })
}

/// 広い屋敷は 30 種。番号は 101〜130（10 種の 1〜10 と重ならない）。
pub fn wide_skeletons_are_numbered_after_the_normal_ones_test() {
  let wide = stage.wide_skeletons()
  list.length(wide) |> should.equal(list.length(wide_skeleton_maps.maps))
  list.map(wide, fn(s) { s.id })
  |> should.equal(list.index_map(wide, fn(_, i) { 101 + i }))
  list.all(wide, stage.is_wide) |> should.be_true
  list.any(stage.skeletons(), stage.is_wide) |> should.be_false
}

/// 1 段目の確率は 4 分の 1。
pub fn wide_probability_is_a_quarter_test() {
  stage.wide_probability |> should.equal(0.25)
}

/// 旗が立っていれば、おまかせで、広い屋敷が約 4 分の 1（22〜28%）。1 段目（draw_kind）を 4,000 回引く。
pub fn mixed_draws_wide_about_a_quarter_when_ready_test() {
  let wide =
    seeds(draws)
    |> list.count(fn(seed) { stage.draw_kind(seed, True).0 == stage.Wide })
  { wide * 100 >= 22 * draws && wide * 100 <= 28 * draws } |> should.be_true
}

/// 旗が下りていれば、おまかせでも、広い屋敷は 0%。抽選は、ふつうだけと完全に同じ。
pub fn mixed_draws_no_wide_when_not_ready_test() {
  list.each(seeds(draws), fn(seed) {
    stage.draw_kind(seed, False) |> should.equal(#(stage.Normal, seed))
  })
  list.each(seeds(200), fn(seed) {
    stage.generate_mixed(seed, False) |> should.equal(stage.generate(seed))
  })
}

/// 2 段目は、選んだ種類の中から一様に。30 種がすべて選ばれうる（4,000 回で、どれも 1 回以上）。
pub fn every_wide_skeleton_can_be_chosen_test() {
  let chosen =
    seeds(draws)
    |> list.map(fn(seed) { stage.draw_wide_index(seed).0 })
    |> set.from_list
  set.size(chosen) |> should.equal(30)
  // おまかせから選ばれた広い屋敷も、30 種に散らばる（1 段目のあとの種で、2 段目を引く）。
  let mixed =
    seeds(draws)
    |> list.filter_map(fn(seed) {
      case stage.draw_kind(seed, True) {
        #(stage.Wide, next) -> Ok(stage.draw_wide_index(next).0)
        _ -> Error(Nil)
      }
    })
    |> set.from_list
  set.size(mixed) |> should.equal(30)
  // おまかせで広い屋敷に当たると、その骨格は広い屋敷の 1 つ。
  let assert Ok(seed) =
    list.find(seeds(draws), fn(seed) {
      stage.draw_kind(seed, True).0 == stage.Wide
    })
  stage.is_wide(stage.generate_mixed(seed, True).skeleton) |> should.be_true
}

/// 同じ種なら、同じ結果（再現できる）。
pub fn same_seed_gives_the_same_wide_layout_test() {
  stage.generate_wide(42) |> should.equal(stage.generate_wide(42))
  stage.generate_mixed(42, True) |> should.equal(stage.generate_mixed(42, True))
}

/// 広い屋敷の部屋の数は、和室系 18〜24、押し入れ 7〜11（10 種は 8〜12・3〜5 のまま）。
/// 大スロットには和室系、小スロットには押し入れ単体。
pub fn wide_layouts_follow_the_wide_composition_test() {
  list.each(seeds(60), fn(seed) {
    let layout = stage.generate_wide(seed)
    let washitsu = stage.washitsu_count(layout)
    let oshiire = stage.oshiire_count(layout)
    { washitsu >= 18 && washitsu <= 24 } |> should.be_true
    { oshiire >= 7 && oshiire <= 11 } |> should.be_true
    list.each(layout.skeleton.slots, fn(slot) {
      case slot.size, dict.get(layout.rooms, slot.id) {
        Small, Ok(room) -> room |> should.equal(Oshiire)
        Large, Ok(room) -> { room != Oshiire } |> should.be_true
        _, Error(Nil) -> Nil
      }
    })
  })
  let composition = stage.composition(stage.Wide)
  composition |> should.equal(stage.Composition(18, 24, 7, 11))
  stage.composition(stage.Normal)
  |> should.equal(stage.Composition(8, 12, 3, 5))
}

/// 種類は、骨格の番号から分かる。
pub fn kind_of_skeleton_test() {
  list.each(stage.skeletons(), fn(s) {
    stage.kind_of(s) |> should.equal(stage.Normal)
  })
  list.each(stage.wide_skeletons(), fn(s) {
    stage.kind_of(s) |> should.equal(stage.Wide)
  })
}
