/// ルーム台帳。ゲーム種別ごとの同時アクティブルーム数を数え、上限を守る（ADR 0030）。
///
/// ルームの生成は room_supervisor に任せ、ここは「作ってよいか」の判断と数の管理だけを
/// 持つ。上限は種別ごとの設定として受け取り、設定のない種別（Tilt Maze 等）は無制限の
/// まま影響しない。ルームの終了（解散・異常終了）はプロセスの監視で検知して数を減らす。
/// 実接続（issue-31）のために、ルーム ID からルームを引く find と、種別ごとの列挙も持つ。
import gleam/dict.{type Dict}
import gleam/erlang/process.{type Pid, type Subject}
import gleam/list
import gleam/otp/actor
import rondo_server/room/room_actor.{type RoomSpec}
import rondo_server/room/room_supervisor.{type RoomSupervisor}

/// 作成が断られる理由。
pub type OpenError {
  /// その種別の同時アクティブルーム数が上限に達している。
  LimitReached
  /// ルームの起動に失敗した。
  StartFailed
}

pub opaque type Message {
  Open(
    spec: RoomSpec,
    reply: Subject(Result(Subject(room_actor.Message), OpenError)),
  )
  ActiveCount(game_type: String, reply: Subject(Int))
  Find(
    room_id: String,
    reply: Subject(Result(Subject(room_actor.Message), Nil)),
  )
  Rooms(game_type: String, reply: Subject(List(Subject(room_actor.Message))))
  RoomDown(process.Down)
}

/// 生きているルーム1つ分の記録。
type Entry {
  Entry(game_type: String, room_id: String, room: Subject(room_actor.Message))
}

type State {
  State(
    supervisor: RoomSupervisor,
    /// 種別ごとの上限。ここにない種別は無制限。
    limits: Dict(String, Int),
    /// 生きているルームのプロセスと、その種別・ID・送り先。
    active: Dict(Pid, Entry),
  )
}

/// 台帳を起動する。limits は種別ごとの同時ルーム数の上限（例: veryare は 3）。
pub fn start(
  supervisor: RoomSupervisor,
  limits: Dict(String, Int),
) -> actor.StartResult(Subject(Message)) {
  actor.new_with_initialiser(1000, fn(self) {
    let selector =
      process.new_selector()
      |> process.select(self)
      |> process.select_monitors(RoomDown)
    State(supervisor:, limits:, active: dict.new())
    |> actor.initialised
    |> actor.selecting(selector)
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
}

/// ルームを作る。上限に達していれば LimitReached。
pub fn open(
  directory: Subject(Message),
  spec: RoomSpec,
) -> Result(Subject(room_actor.Message), OpenError) {
  process.call(directory, 1000, Open(spec, _))
}

/// ルーム ID からルームを引く。無ければ Error。
pub fn find(
  directory: Subject(Message),
  room_id: String,
) -> Result(Subject(room_actor.Message), Nil) {
  process.call(directory, 1000, Find(room_id, _))
}

/// その種別の、いま生きているルーム（作られた順）。
pub fn rooms(
  directory: Subject(Message),
  game_type: String,
) -> List(Subject(room_actor.Message)) {
  process.call(directory, 1000, Rooms(game_type, _))
}

/// その種別の、いま生きているルーム数。
pub fn active_count(directory: Subject(Message), game_type: String) -> Int {
  process.call(directory, 1000, ActiveCount(game_type, _))
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Open(spec, reply) -> {
      let #(state, result) = open_room(state, spec)
      process.send(reply, result)
      actor.continue(state)
    }

    ActiveCount(game_type, reply) -> {
      process.send(reply, count(state, game_type))
      actor.continue(state)
    }

    Find(room_id, reply) -> {
      let found =
        state.active
        |> dict.values
        |> list.find(fn(entry) { entry.room_id == room_id })
      process.send(reply, case found {
        Ok(entry) -> Ok(entry.room)
        Error(Nil) -> Error(Nil)
      })
      actor.continue(state)
    }

    Rooms(game_type, reply) -> {
      process.send(
        reply,
        state.active
          |> dict.values
          |> list.filter(fn(entry) { entry.game_type == game_type })
          |> list.map(fn(entry) { entry.room }),
      )
      actor.continue(state)
    }

    RoomDown(process.ProcessDown(pid:, ..)) ->
      actor.continue(State(..state, active: dict.delete(state.active, pid)))

    RoomDown(process.PortDown(..)) -> actor.continue(state)
  }
}

fn open_room(
  state: State,
  spec: RoomSpec,
) -> #(State, Result(Subject(room_actor.Message), OpenError)) {
  let full = case dict.get(state.limits, spec.game_type) {
    Ok(limit) -> count(state, spec.game_type) >= limit
    Error(Nil) -> False
  }
  case full {
    True -> #(state, Error(LimitReached))
    False ->
      case room_supervisor.open_room(state.supervisor, spec) {
        Ok(started) -> {
          let _ = process.monitor(started.pid)
          let room_actor.RoomId(room_id) = spec.id
          let entry =
            Entry(game_type: spec.game_type, room_id:, room: started.data)
          let active = dict.insert(state.active, started.pid, entry)
          #(State(..state, active:), Ok(started.data))
        }
        Error(_) -> #(state, Error(StartFailed))
      }
  }
}

fn count(state: State, game_type: String) -> Int {
  state.active
  |> dict.values
  |> list.count(fn(entry) { entry.game_type == game_type })
}
