/// ソケット1本のプロセスが使ってよいメモリの上限（issue-51）。
///
/// mist は、受信した WebSocket フレームを、1つにつながるまでソケットのプロセスの受信バッファに
/// 溜める。アプリの層（連想のハンドラ）に届くのは、つながった後なので、大きさを手前で測って
/// 止められない。唯一、VM の中で止められるのは、このプロセスの使ってよいメモリの上限を決める
/// こと。超えたら、そのプロセスだけを落とす（他の接続とルームは、別のプロセスなので波及しない）。
///
/// 正しいクライアントの電文は、どれも数十 KB まで（ステージの通知、ペイントの確定など）なので、
/// 64 MiB はきわめて大きな余裕がある。これは、極端に大きな電文への手当てで、ふだんは当たらない。
/// 最後の砦は、コンテナのメモリ上限（docker-compose.server.prod.yml の mem_limit）。
import gleam/int
import gleam/io

/// ソケット1本が使ってよいメモリの上限（バイト）。
pub const limit_bytes = 67_108_864

/// include_shared_binaries（受信バッファを上限に数えるキー）が使える最小の OTP 版。
const shared_binaries_min_otp = 27

/// いま動いているプロセス（ソケット1本のプロセス）に、使ってよいメモリの上限を設ける。
/// on_init から1回だけ呼ぶ。失敗しても接続は続ける（mem_limit が最後の砦）。
pub fn limit_current_socket() -> Nil {
  limit_self_heap(limit_bytes)
}

/// テスト用: 任意のバイト数で、いま動いているプロセスに上限を設ける。
pub fn limit_current_socket_to(bytes: Int) -> Nil {
  limit_self_heap(int.max(bytes, 0))
}

/// 受信バッファを上限に数える仕組み（include_shared_binaries）が、この OTP で使えるか。
pub fn shared_binaries_supported() -> Bool {
  otp_major() >= shared_binaries_min_otp
}

/// 起動時に1回呼ぶ。上の仕組みが使えない（OTP 27 未満）なら、ソケット1本ごとの上限が
/// 実質は効かない（受信バッファは共有バイナリで、heap に数えられない）ことを、1行警告する。
/// その場合の最後の砦は、コンテナのメモリ上限（docker-compose の mem_limit）。
pub fn warn_if_unsupported() -> Nil {
  case shared_binaries_supported() {
    True -> Nil
    False ->
      io.println(
        "rondo server: 警告: この OTP（"
        <> int.to_string(otp_major())
        <> "）は include_shared_binaries を使えません（27 以降が必要）。"
        <> "ソケット1本ごとのメモリ上限は実質効きません。コンテナのメモリ上限（mem_limit）が最後の砦です。",
      )
  }
}

/// ソケットの受信プロセスが異常終了した（メモリ上限など）ことを、ログに1行だけ残す。
/// 短時間に何度も出さないよう、1分あたり数回までにする（それ以上は数えるだけ）。
/// ふだんの切断では呼ばない。接続アクターが、監視で異常終了を知ったときだけ呼ぶ。
@external(erlang, "rondo_server_ffi", "note_socket_killed")
pub fn note_socket_killed() -> Nil

@external(erlang, "rondo_server_ffi", "limit_self_heap")
fn limit_self_heap(bytes: Int) -> Nil

@external(erlang, "rondo_server_ffi", "otp_major")
fn otp_major() -> Int
