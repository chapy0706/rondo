/// 実接続の入口（issue-31）。WebSocket の殻（connection/websocket）と結合テストが共通で使う。
///
/// ソケット1本ごとに接続アクターを1つ開き、受け取った電文を渡す。reconnect だけはここで
/// 扱い、復帰トークンで切断中の接続アクターを引いて新しいソケットに付け替える。付け替えに
/// 成功したら、接続時に開いた新しい接続アクターは使わないので止める。
import gleam/erlang/process.{type Subject}
import gleam/otp/actor
import rondo_server/connection/heartbeat
import rondo_server/connection/session
import rondo_server/connection/session_actor
import rondo_server/connection/sessions
import rondo_server/protocol/message.{
  type ClientMessage, type ServerMessage, ErrorMessage, Pong, Reconnect,
}

/// 再接続猶予の既定値（ミリ秒 / ADR 0013）。
pub const default_grace_ms = 10_000

pub type Deps {
  Deps(
    session: session.Deps,
    sessions: Subject(sessions.Message),
    /// 再接続猶予（ミリ秒）。本番は default_grace_ms、テストでは短くする。
    grace_ms: Int,
    /// ハートビートの間隔と待ち時間（issue-41）。本番は heartbeat.default_config()。
    heartbeat: heartbeat.Config,
  )
}

/// ソケットを開いた。接続アクターを起動して台帳に登録し、本人に session を送る。
pub fn open(
  deps: Deps,
  socket: Subject(ServerMessage),
) -> Subject(session_actor.Message) {
  let assert Ok(started) =
    session_actor.start(deps.session, socket, deps.grace_ms)
  let state = session_actor.get_session(started.data)
  sessions.register(
    deps.sessions,
    state.resume_token,
    started.data,
    started.pid,
  )
  started.data
}

/// クライアントの電文を渡す。戻り値は、以後このソケットが使う接続アクター
/// （再接続に成功したら復帰先に変わる）。
pub fn receive(
  deps: Deps,
  current: Subject(session_actor.Message),
  socket: Subject(ServerMessage),
  incoming: ClientMessage,
) -> Subject(session_actor.Message) {
  case incoming {
    Reconnect(room_id, resume_token) ->
      case resume(deps, current, socket, room_id, resume_token) {
        Ok(resumed) -> {
          session_actor.stop(current)
          resumed
        }
        Error(Nil) -> {
          process.send(
            socket,
            ErrorMessage("reconnect-failed", "前の接続に戻れませんでした。もう一度ルームに入ってください。"),
          )
          current
        }
      }
    // ハートビートの応答。届いたこと自体はソケットの殻がハートビートへ伝える。
    // 接続の層で受け取るだけで、接続アクター・ルーム・ゲームには渡さない（issue-41）。
    Pong -> current
    _ -> {
      session_actor.client_message(current, incoming)
      current
    }
  }
}

/// ソケットのハートビートを起動する（issue-41）。ping は socket へ直接送る。待ち時間の
/// あいだクライアントから何も届かなければ、timed_out に Nil が届く（受けた殻はソケットを
/// 閉じ、close を通して再接続猶予に入る）。
pub fn start_heartbeat(
  deps: Deps,
  socket: Subject(ServerMessage),
  timed_out: Subject(Nil),
) -> Result(Subject(heartbeat.Message), actor.StartError) {
  heartbeat.start(deps.heartbeat, socket, timed_out)
}

/// ソケットが閉じた。接続アクターに切断を伝える（猶予の判断はアクターが行う）。
pub fn close(
  current: Subject(session_actor.Message),
  socket: Subject(ServerMessage),
) -> Nil {
  session_actor.detach(current, socket)
}

fn resume(
  deps: Deps,
  current: Subject(session_actor.Message),
  socket: Subject(ServerMessage),
  room_id: String,
  resume_token: String,
) -> Result(Subject(session_actor.Message), Nil) {
  case sessions.lookup(deps.sessions, resume_token) {
    Ok(target) if target != current ->
      case session_actor.resume(target, room_id, resume_token, socket) {
        True -> Ok(target)
        False -> Error(Nil)
      }
    _ -> Error(Nil)
  }
}
