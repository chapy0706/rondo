import gleam/erlang/process.{type Subject, type Timer}
import gleam/option.{type Option, None, Some}
import gleam/otp/actor

/// 再接続猶予の既定値（ミリ秒）。ADR 0013 で定めた10秒。
/// 実際の猶予は start の引数で受け取り、値の直書きを避ける。
pub const default_grace_ms = 10_000

/// 接続を一意に識別するID。境界（WebSocket接続確立時）で発行し、
/// レジストリの鍵になる。単一接続の多重化（ADR 0007）でも、
/// 論理的な接続の単位はこのIDで表す。
pub type ConnectionId {
  ConnectionId(String)
}

/// 接続の生存状態。プロセス内に閉じ、外からは status で問い合わせる（ADR 0006）。
pub type Status {
  /// クライアントと繋がっている。
  Connected
  /// 切断され、再接続猶予の最中。猶予を過ぎると離脱が確定する（ADR 0013）。
  AwaitingReconnect
}

/// 接続アクターが受け取るメッセージ。
///
/// Disconnected / Reconnected は境界（WebSocketのライフサイクル）から送る。
/// GraceExpired は猶予タイマーが自分自身に送る内部メッセージ。
pub type Message {
  /// クライアントが切断した。再接続猶予タイマーを起動する。
  Disconnected
  /// 猶予内に再接続した。タイマーを解除し接続状態へ戻す。
  Reconnected
  /// 猶予が切れた（タイマー発火）。離脱を確定し、アクターを終了する。
  GraceExpired
  /// 現在の状態を問い合わせる（監視・テスト用）。
  GetStatus(reply: Subject(Status))
  /// 接続アクターを明示的に停止する。
  Shutdown
}

/// アクターの内部状態。プロセスに閉じ込める。
type State {
  State(
    id: ConnectionId,
    /// 自分自身への Subject。猶予タイマーの送り先に使う。
    self: Subject(Message),
    /// 再接続猶予（ミリ秒）。ADR 0013 の方針を呼び出し側が渡す。
    grace_ms: Int,
    status: Status,
    /// 起動中の猶予タイマー。再接続時に解除するため保持する。
    grace_timer: Option(Timer),
  )
}

/// 接続アクターを起動する。接続ごとに1つ立てる（ADR 0006）。
///
/// grace_ms には再接続猶予を渡す。運用値は default_grace_ms。
/// 戻り値の Started.data が、このアクターへ送るための Subject。
pub fn start(
  id: ConnectionId,
  grace_ms: Int,
) -> Result(actor.Started(Subject(Message)), actor.StartError) {
  actor.new_with_initialiser(1000, fn(self) {
    State(
      id: id,
      self: self,
      grace_ms: grace_ms,
      status: Connected,
      grace_timer: None,
    )
    |> actor.initialised
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
}

/// 現在の状態を問い合わせる。
pub fn status(connection: Subject(Message)) -> Status {
  process.call(connection, 1000, GetStatus)
}

/// 切断を通知する。再接続猶予タイマーが動き出す。
pub fn disconnect(connection: Subject(Message)) -> Nil {
  process.send(connection, Disconnected)
}

/// 再接続を通知する。猶予タイマーが解除され、接続状態へ戻る。
pub fn reconnect(connection: Subject(Message)) -> Nil {
  process.send(connection, Reconnected)
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Disconnected -> {
      // 既存のタイマーがあれば張り替える前に解除しておく。
      cancel_grace(state.grace_timer)
      let timer = process.send_after(state.self, state.grace_ms, GraceExpired)
      actor.continue(
        State(..state, status: AwaitingReconnect, grace_timer: Some(timer)),
      )
    }

    Reconnected -> {
      cancel_grace(state.grace_timer)
      actor.continue(State(..state, status: Connected, grace_timer: None))
    }

    GraceExpired ->
      case state.status {
        // 猶予が切れた。離脱を確定し、プロセスを終える。
        AwaitingReconnect -> actor.stop()
        // 既に再接続済み。解除が間に合わなかった発火なので無視する。
        Connected -> actor.continue(state)
      }

    GetStatus(reply) -> {
      process.send(reply, state.status)
      actor.continue(state)
    }

    Shutdown -> actor.stop()
  }
}

fn cancel_grace(timer: Option(Timer)) -> Nil {
  case timer {
    Some(t) -> {
      let _ = process.cancel_timer(t)
      Nil
    }
    None -> Nil
  }
}
