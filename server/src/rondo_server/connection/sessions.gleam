/// 接続アクターの台帳（issue-31）。復帰トークンから接続アクターを引く。
///
/// 接続アクターのプロセスを監視し、止まったら（猶予切れ・退出後の切断・復帰で捨てられた
/// 接続）自動で台帳から消す。トークンは本人にだけ渡る秘密の値なので、ここを引けるのは
/// トークンを持つ本人だけ（ADR 0021 と同じく、他人に復帰の手がかりを渡さない）。
import gleam/dict.{type Dict}
import gleam/erlang/process.{type Pid, type Subject}
import gleam/otp/actor
import rondo_server/connection/session_actor

pub opaque type Message {
  Register(token: String, actor: Subject(session_actor.Message), pid: Pid)
  Lookup(
    token: String,
    reply: Subject(Result(Subject(session_actor.Message), Nil)),
  )
  Down(process.Down)
}

type State {
  State(
    by_token: Dict(String, Subject(session_actor.Message)),
    token_of: Dict(Pid, String),
  )
}

pub fn start() -> actor.StartResult(Subject(Message)) {
  actor.new_with_initialiser(1000, fn(self) {
    let selector =
      process.new_selector()
      |> process.select(self)
      |> process.select_monitors(Down)
    State(by_token: dict.new(), token_of: dict.new())
    |> actor.initialised
    |> actor.selecting(selector)
    |> actor.returning(self)
    |> Ok
  })
  |> actor.on_message(handle)
  |> actor.start
}

/// 接続アクターを登録する。止まったら自動で消える。
pub fn register(
  registry: Subject(Message),
  token: String,
  actor: Subject(session_actor.Message),
  pid: Pid,
) -> Nil {
  process.send(registry, Register(token, actor, pid))
}

/// トークンから接続アクターを引く。
pub fn lookup(
  registry: Subject(Message),
  token: String,
) -> Result(Subject(session_actor.Message), Nil) {
  process.call(registry, 1000, Lookup(token, _))
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Register(token, subject, pid) -> {
      let _ = process.monitor(pid)
      actor.continue(State(
        by_token: dict.insert(state.by_token, token, subject),
        token_of: dict.insert(state.token_of, pid, token),
      ))
    }

    Lookup(token, reply) -> {
      process.send(reply, dict.get(state.by_token, token))
      actor.continue(state)
    }

    Down(process.ProcessDown(pid:, ..)) ->
      case dict.get(state.token_of, pid) {
        Ok(token) ->
          actor.continue(State(
            by_token: dict.delete(state.by_token, token),
            token_of: dict.delete(state.token_of, pid),
          ))
        Error(Nil) -> actor.continue(state)
      }

    Down(process.PortDown(..)) -> actor.continue(state)
  }
}
