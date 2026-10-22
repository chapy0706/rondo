import gleam/int
import gleam/list
import gleam/set
import gleeunit/should
import rondo_server/connection/user_number

// 表示名（userN）の番号の選び方（issue-71）。空いている一番小さい番号から使い回す。

pub fn smallest_free_starts_at_one_test() {
  user_number.smallest_free(set.new()) |> should.equal(1)
}

pub fn smallest_free_fills_the_first_gap_test() {
  user_number.smallest_free(set.from_list([1, 2, 4, 5])) |> should.equal(3)
  user_number.smallest_free(set.from_list([2, 3])) |> should.equal(1)
  user_number.smallest_free(set.from_list([1, 2, 3])) |> should.equal(4)
}

pub fn name_keeps_the_user_n_shape_test() {
  user_number.name(1) |> should.equal("user1")
  user_number.name(33) |> should.equal("user33")
}

pub fn acquire_gives_new_owners_the_smallest_free_number_test() {
  let numbers = user_number.new()
  let #(numbers, a) = user_number.acquire(numbers, "a")
  let #(numbers, b) = user_number.acquire(numbers, "b")
  let #(_, c) = user_number.acquire(numbers, "c")
  #(a, b, c) |> should.equal(#(1, 2, 3))
}

pub fn acquire_twice_returns_the_same_number_test() {
  let #(numbers, first) = user_number.acquire(user_number.new(), "a")
  let #(numbers, again) = user_number.acquire(numbers, "a")
  again |> should.equal(first)
  user_number.in_use(numbers) |> should.equal([1])
}

pub fn release_frees_the_number_for_the_next_owner_test() {
  // 3 人のうち、2 番目が抜けると、次の人は 2 をもらう。
  let numbers = user_number.new()
  let #(numbers, _) = user_number.acquire(numbers, "a")
  let #(numbers, _) = user_number.acquire(numbers, "b")
  let #(numbers, _) = user_number.acquire(numbers, "c")
  let numbers = user_number.release(numbers, "b")
  let #(_, d) = user_number.acquire(numbers, "d")
  d |> should.equal(2)
}

pub fn release_of_everyone_starts_over_at_one_test() {
  let numbers = user_number.new()
  let #(numbers, _) = user_number.acquire(numbers, "a")
  let #(numbers, _) = user_number.acquire(numbers, "b")
  let numbers = numbers |> user_number.release("a") |> user_number.release("b")
  user_number.in_use(numbers) |> should.equal([])
  let #(_, next) = user_number.acquire(numbers, "c")
  next |> should.equal(1)
}

pub fn release_of_an_unknown_owner_changes_nothing_test() {
  let #(numbers, _) = user_number.acquire(user_number.new(), "a")
  user_number.release(numbers, "nobody") |> should.equal(numbers)
}

pub fn many_owners_never_share_a_number_test() {
  // 200 人が入り、偶数番目が抜け、100 人が入り直す。重ならず、空きの小さい順に埋まる。
  let owners = span(1, 200)
  let numbers =
    list.fold(owners, user_number.new(), fn(acc, owner) {
      user_number.acquire(acc, owner).0
    })
  user_number.in_use(numbers) |> should.equal(span(1, 200))
  let numbers =
    list.fold(owners, numbers, fn(acc, owner) {
      case int.is_even(owner) {
        True -> user_number.release(acc, owner)
        False -> acc
      }
    })
  let #(numbers, given) =
    list.fold(span(1001, 1100), #(numbers, []), fn(acc, owner) {
      let #(numbers, given) = acc
      let #(numbers, number) = user_number.acquire(numbers, owner)
      #(numbers, [number, ..given])
    })
  list.reverse(given)
  |> should.equal(list.filter(span(1, 200), int.is_even))
  user_number.in_use(numbers) |> should.equal(span(1, 200))
}

/// from から to まで（両端を含む）の整数。
fn span(from: Int, to: Int) -> List(Int) {
  do_span(to, from, [])
}

fn do_span(current: Int, from: Int, acc: List(Int)) -> List(Int) {
  case current < from {
    True -> acc
    False -> do_span(current - 1, from, [current, ..acc])
  }
}
