/// ハートビート（issue-41 / ADR 0041）。WebSocket のソケット1本ごとに1つ動く。
///
/// - 通信の有無にかかわらず、固定の間隔（既定 20 秒）で ping を送る。無通信の接続が
///   Cloudflare（Tunnel）に切られないようにする
/// - クライアントからの電文（pong を含め何でもよい）が、待ち時間（既定 50 秒）のあいだ
///   届かなければ、ソケットを閉じるよう頼んで止まる。閉じたソケットは、接続アクターの
///   再接続猶予（ADR 0013、10 秒）に入る
///
/// ping はソケットへ直接送り、接続アクター（session_actor）・ルーム・ゲームを通さない。
/// mist はクライアントの pong フレームを渡さず、サーバーから ping フレームを送る公開の
/// 関数も持たないため、プロトコル上の ping/pong ではなく、アプリ層の電文で行う。
import gleam/erlang/process.{type Pid, type Subject}
import gleam/otp/actor
import rondo_server/protocol/message.{type ServerMessage, Ping}

/// ping の間隔の既定（ミリ秒）。cloudflared の keepAliveTimeout（90 秒）の半分以下。
pub const default_interval_ms = 20_000

/// 応答を待つ時間の既定（ミリ秒）。ping 2 回分に余裕を足した長さ。
pub const default_timeout_ms = 50_000

pub type Config {
  Config(interval_ms: Int, timeout_ms: Int)
}

pub fn default_config() -> Config {
  Config(interval_ms: default_interval_ms, timeout_ms: default_timeout_ms)
}

/// 待ち時間の判定の結果。
pub type Check {
  /// まだつながっている。recheck_in ミリ秒後に確かめ直す。
  Alive(recheck_in: Int)
  /// 待ち時間を過ぎた。接続を失ったとみなす。
  Expired
}

/// 最後にクライアントから届いた時刻（last_seen）と今（now）から、待ち時間を過ぎたかを決める。
pub fn check(
  last_seen last_seen: Int,
  now now: Int,
  timeout_ms timeout_ms: Int,
) -> Check {
  let elapsed = now - last_seen
  case elapsed >= timeout_ms {
    True -> Expired
    False -> Alive(recheck_in: timeout_ms - elapsed)
  }
}

pub opaque type Message {
  /// 間隔のタイマー。ping を送って、次を張る。
  Tick
  /// 待ち時間のタイマー。
  Check
  /// クライアントから何か届いた。
  Seen
  /// ソケットが閉じた。止まる。
  Stop
}

type State {
  State(
    self: Subject(Message),
    config: Config,
    outbox: Subject(ServerMessage),
    timed_out: Subject(Nil),
    last_seen: Int,
  )
}

/// 起動する。outbox はソケットへの送信先（ping を送る）。timed_out には、待ち時間を
/// 過ぎたときに一度だけ Nil を送る（受け取ったソケットは自分を閉じる）。
pub fn start(
  config: Config,
  outbox: Subject(ServerMessage),
  timed_out: Subject(Nil),
) -> Result(Subject(Message), actor.StartError) {
  actor.new_with_initialiser(1000, fn(self) {
    let _ = process.send_after(self, config.interval_ms, Tick)
    let _ = process.send_after(self, config.timeout_ms, Check)
    State(self:, config:, outbox:, timed_out:, last_seen: now_ms())
    |> actor.initialised
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
  |> result_data
}

/// クライアントから何か届いたことを伝える。
pub fn seen(heartbeat: Subject(Message)) -> Nil {
  process.send(heartbeat, Seen)
}

/// 止める（ソケットが閉じたとき）。
pub fn stop(heartbeat: Subject(Message)) -> Nil {
  process.send(heartbeat, Stop)
}

/// 動いているプロセス（監視・テスト用）。
pub fn pid(heartbeat: Subject(Message)) -> Pid {
  let assert Ok(pid) = process.subject_owner(heartbeat)
  pid
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Tick -> {
      process.send(state.outbox, Ping)
      let _ = process.send_after(state.self, state.config.interval_ms, Tick)
      actor.continue(state)
    }
    Seen -> actor.continue(State(..state, last_seen: now_ms()))
    Check ->
      case check(state.last_seen, now_ms(), state.config.timeout_ms) {
        Expired -> {
          process.send(state.timed_out, Nil)
          actor.stop()
        }
        Alive(recheck_in) -> {
          let _ = process.send_after(state.self, recheck_in, Check)
          actor.continue(state)
        }
      }
    Stop -> actor.stop()
  }
}

fn result_data(
  started: Result(actor.Started(Subject(Message)), actor.StartError),
) -> Result(Subject(Message), actor.StartError) {
  case started {
    Ok(started) -> Ok(started.data)
    Error(error) -> Error(error)
  }
}

/// 単調に増える時刻（ミリ秒）。時計の巻き戻りの影響を受けない。
@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn now_ms() -> Int
