/// ソケット1本のメモリの上限（issue-51）。上限を低くしたプロセスが、大きな電文（受信
/// バッファ）を溜めると、そのプロセスだけが落ちること、上限が十分なら落ちないこと、隣の
/// プロセス（ほかの接続やルームに相当）は波及を受けず最後まで走りきることを確かめる。
import gleam/bit_array
import gleam/erlang/process
import gleeunit/should
import rondo_server/connection/heap_guard

/// 2^n バイトのバイナリ（倍々で作る）。
fn block(n: Int) -> BitArray {
  case n {
    0 -> <<0>>
    _ -> {
      let half = block(n - 1)
      <<half:bits, half:bits>>
    }
  }
}

/// 1 MiB を count 個つなげて、プロセスのメモリを膨らませる。つないだ合計のビット数を返す。
fn grow(buffer: BitArray, count: Int) -> Int {
  case count {
    0 -> bit_array.bit_size(buffer)
    _ -> grow(<<buffer:bits, block(mib_power):bits>>, count - 1)
  }
}

const mib_power = 20

/// 上限を 8 MiB にしたプロセスで 64 MiB ぶん溜めると、そのプロセスは落ちる（結果は返らない）。
/// 一方、上限を設けない隣のプロセスは、同じころ 32 MiB を溜めても、落ちずに結果を返す。
pub fn over_limit_process_is_killed_but_sibling_survives_test() {
  let from_child = process.new_subject()
  let from_sibling = process.new_subject()

  let child =
    process.spawn_unlinked(fn() {
      heap_guard.limit_current_socket_to(8 * 1024 * 1024)
      process.send(from_child, grow(<<>>, 64))
    })
  let monitor = process.monitor(child)

  // 隣のプロセス（ルームに相当）。上限は設けず、32 MiB を溜めて結果を返す。
  process.spawn_unlinked(fn() { process.send(from_sibling, grow(<<>>, 32)) })

  // 上限を超えた子は落ちる（monitor の Down が届き、結果は返らない）。
  let down =
    process.new_selector()
    |> process.select_specific_monitor(monitor, fn(_) { Nil })
    |> process.selector_receive(5000)
  down |> should.equal(Ok(Nil))
  process.receive(from_child, 0) |> should.equal(Error(Nil))

  // 隣のプロセスは、子が落ちても最後まで走りきる（32 MiB ぶんのビット数）。
  process.receive(from_sibling, 5000)
  |> should.equal(Ok(32 * 1024 * 1024 * 8))
}

/// 上限を十分に大きく（128 MiB）すれば、64 MiB ぶん溜めても落ちず、結果が返る
/// （正しいクライアントの電文は数十 KB までなので、ふだんは当たらないことの代わりの確認）。
pub fn within_limit_process_survives_test() {
  let from_child = process.new_subject()
  process.spawn_unlinked(fn() {
    heap_guard.limit_current_socket_to(128 * 1024 * 1024)
    process.send(from_child, grow(<<>>, 64))
  })
  process.receive(from_child, 5000)
  |> should.equal(Ok(64 * 1024 * 1024 * 8))
}

/// この OTP（開発・CI・本番のコンテナは 27 以降のはず）では、受信バッファを上限に数える
/// 仕組みが使える。使えない OTP だと、ソケット1本ごとの上限が実質効かないので、ここで気づく。
pub fn shared_binaries_are_supported_on_this_otp_test() {
  heap_guard.shared_binaries_supported() |> should.be_true
}
