/// 表示名（userN）の番号の選び方（issue-71 / ADR 0052）。プロセスを持たない純粋な部分。
///
/// 番号は、持ち主（接続）ごとに 1 つ。新しい持ち主には、空いている一番小さい番号を渡し、
/// 持ち主が終わったら、その番号を空ける。窓口（プロセスの部分）は connection/sessions が持つ。
/// 同時に生きている持ち主の間で、番号は重ならない。
import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/set.{type Set}

pub opaque type Numbers(owner) {
  Numbers(by_owner: Dict(owner, Int), used: Set(Int))
}

pub fn new() -> Numbers(owner) {
  Numbers(by_owner: dict.new(), used: set.new())
}

/// 使われていない、一番小さい番号（1 から）。
pub fn smallest_free(used: Set(Int)) -> Int {
  do_smallest_free(used, 1)
}

fn do_smallest_free(used: Set(Int), candidate: Int) -> Int {
  case set.contains(used, candidate) {
    True -> do_smallest_free(used, candidate + 1)
    False -> candidate
  }
}

/// 表示名の形（これまでと同じ user + 番号 / ADR 0015）。
pub fn name(number: Int) -> String {
  "user" <> int.to_string(number)
}

/// 持ち主に番号を渡す。すでに持っていれば、同じ番号を返す。
pub fn acquire(
  numbers: Numbers(owner),
  owner: owner,
) -> #(Numbers(owner), Int) {
  case dict.get(numbers.by_owner, owner) {
    Ok(number) -> #(numbers, number)
    Error(Nil) -> {
      let number = smallest_free(numbers.used)
      #(
        Numbers(
          by_owner: dict.insert(numbers.by_owner, owner, number),
          used: set.insert(numbers.used, number),
        ),
        number,
      )
    }
  }
}

/// 持ち主の番号を空ける。番号を持っていなければ、何も変えない。
pub fn release(numbers: Numbers(owner), owner: owner) -> Numbers(owner) {
  case dict.get(numbers.by_owner, owner) {
    Ok(number) ->
      Numbers(
        by_owner: dict.delete(numbers.by_owner, owner),
        used: set.delete(numbers.used, number),
      )
    Error(Nil) -> numbers
  }
}

/// いま使われている番号（小さい順。監視・テスト用）。
pub fn in_use(numbers: Numbers(owner)) -> List(Int) {
  numbers.used |> set.to_list |> list.sort(int.compare)
}
