/// リアルタイムの WebSocket の受け口（issue-31 / ADR 0006・0007）。
///
/// ソケット1本につき1プロセス（mist の WebSocket プロセス）。プレイヤーの状態は接続
/// アクター（connection/session_actor）が持ち、ここは電文を渡してソケットへ送るだけの殻。
/// 1本の接続で、ロビー・ルーム・ゲームの電文をすべて運ぶ（多重化）。
///
/// - 接続時に接続アクターを開き、本人へ session（プレイヤー識別子と復帰トークン）を送る
/// - テキストの電文を decode して渡す。形の違う電文は error を返す
/// - reconnect で、切断中の接続アクターへ付け替える（connection.receive）
/// - 切断したら接続アクターへ伝える。ルームにいれば再接続猶予（10秒）を待つ
/// - ハートビート（issue-41 / ADR 0041）: ソケットごとに起動し、固定の間隔で ping を送る。
///   クライアントから届いた電文（pong を含め何でも）を伝え、待ち時間のあいだ何も届かなければ、
///   ソケットを閉じる（閉じると on_close で接続アクターへ伝わり、猶予に入る）
import gleam/erlang/process.{type Selector, type Subject}
import gleam/http/request.{type Request}
import gleam/http/response.{type Response}
import gleam/option.{type Option, Some}
import mist.{
  type Connection, type ResponseData, type WebsocketConnection,
  type WebsocketMessage, Binary, Closed, Custom, Shutdown, Text,
}
import rondo_server/connection/connection.{type Deps}
import rondo_server/connection/heartbeat
import rondo_server/connection/session_actor
import rondo_server/protocol/message.{type ServerMessage, ErrorMessage}

/// ソケットのプロセスが持つ状態。使っている接続アクターと、このソケットへの送信先、
/// このソケットのハートビート。
type State {
  State(
    actor: Subject(session_actor.Message),
    socket: Subject(ServerMessage),
    heartbeat: Subject(heartbeat.Message),
  )
}

/// ソケットのプロセスに届く、クライアント以外からの知らせ。
type Event {
  /// 接続アクター・ハートビートからの電文。そのままクライアントへ送る。
  Outgoing(ServerMessage)
  /// ハートビートの待ち時間が過ぎた。ソケットを閉じる。
  TimedOut
}

pub fn handle(req: Request(Connection), deps: Deps) -> Response(ResponseData) {
  mist.websocket(
    request: req,
    on_init: fn(_conn) { on_init(deps) },
    on_close: fn(state: State) {
      heartbeat.stop(state.heartbeat)
      connection.close(state.actor, state.socket)
    },
    handler: fn(state, incoming, conn) { loop(state, incoming, conn, deps) },
  )
}

fn on_init(deps: Deps) -> #(State, Option(Selector(Event))) {
  // このソケットへの送信先。接続アクターからの電文は Custom として loop に届く。
  let socket: Subject(ServerMessage) = process.new_subject()
  let timed_out: Subject(Nil) = process.new_subject()
  let selector =
    process.new_selector()
    |> process.select_map(socket, Outgoing)
    |> process.select_map(timed_out, fn(_) { TimedOut })
  let actor = connection.open(deps, socket)
  let assert Ok(heartbeat) = connection.start_heartbeat(deps, socket, timed_out)
  #(State(actor:, socket:, heartbeat:), Some(selector))
}

fn loop(
  state: State,
  incoming: WebsocketMessage(Event),
  conn: WebsocketConnection,
  deps: Deps,
) -> mist.Next(State, Event) {
  case incoming {
    Text(text) -> {
      // 形が正しいかに関わらず、届いたこと自体を生きている印にする。
      heartbeat.seen(state.heartbeat)
      case message.decode_client(text) {
        Ok(parsed) -> {
          let actor =
            connection.receive(deps, state.actor, state.socket, parsed)
          mist.continue(State(..state, actor:))
        }
        Error(_) -> {
          send(conn, ErrorMessage("bad-message", "電文の形が正しくありません。"))
          mist.continue(state)
        }
      }
    }
    // 接続アクター・ハートビートから届いた電文（返信・ルームの配信・ping）をそのまま送る。
    Custom(Outgoing(outgoing)) -> {
      send(conn, outgoing)
      mist.continue(state)
    }
    // 待ち時間のあいだ何も届かなかった。閉じると on_close で猶予に入る。
    Custom(TimedOut) -> mist.stop()
    // rondo はテキストフレームで多重化する。バイナリは想定しないので捨てる（届いた印にはする）。
    Binary(_) -> {
      heartbeat.seen(state.heartbeat)
      mist.continue(state)
    }
    Closed | Shutdown -> mist.stop()
  }
}

fn send(conn: WebsocketConnection, outgoing: ServerMessage) -> Nil {
  let _ = mist.send_text_frame(conn, message.encode_server(outgoing))
  Nil
}
