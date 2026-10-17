import gleam/dynamic.{type Dynamic}
import gleam/erlang/process.{type Pid, type Subject}
import gleam/list
import gleam/otp/actor
import gleam/otp/factory_supervisor as factory
import gleam/otp/supervision
import rondo_server/room/room_actor.{type Message, type RoomSpec}

/// ルームを動的に生成・監視するスーパーバイザーへの参照。
/// ルームは実行中に必要に応じて立ち上がる（ADR 0016 の一覧/新規作成）ため、
/// 固定子ではなく factory（simple_one_for_one 相当）で扱う。
pub type RoomSupervisor =
  factory.Supervisor(RoomSpec, Subject(Message))

/// スーパーバイザーを起動する。
///
/// 子（ルーム）の再起動方針は Temporary（ADR 0047。ADR 0006 の「異常終了のときは回復させる」を、
/// ルームについて置き換える）。落ちたルームを、空の状態で作り直さない。作り直したルームは、台帳にも、
/// 入っていた人の接続にもつながらず、数え漏れと、誰も入れないルームが残るだけだったため。入っていた
/// 人には、接続が room-closed を送る（session_actor）。
pub fn start() -> actor.StartResult(RoomSupervisor) {
  factory.worker_child(room_actor.start)
  |> factory.restart_strategy(supervision.Temporary)
  |> factory.start
}

/// ルームを1つ立ち上げる。作成の入口。
/// 戻り値の Started.data がそのルームへ送るための Subject。
pub fn open_room(
  supervisor: RoomSupervisor,
  spec: RoomSpec,
) -> actor.StartResult(Subject(Message)) {
  factory.start_child(supervisor, spec)
}

@external(erlang, "supervisor", "which_children")
fn which_children(supervisor: Pid) -> List(Dynamic)

/// 監視下にあるルーム数。異常終了からの回復確認・運用監視に使う。
/// スーパーバイザーの Pid（start の戻り値 Started.pid）を渡す。
pub fn room_count(supervisor_pid: Pid) -> Int {
  list.length(which_children(supervisor_pid))
}
