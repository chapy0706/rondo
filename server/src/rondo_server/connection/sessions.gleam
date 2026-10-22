/// 接続アクターの台帳（issue-31）。復帰トークンから接続アクターを引く。
///
/// 接続アクターのプロセスを監視し、止まったら（猶予切れ・退出後の切断・復帰で捨てられた
/// 接続）自動で台帳から消す。トークンは本人にだけ渡る秘密の値なので、ここを引けるのは
/// トークンを持つ本人だけ（ADR 0021 と同じく、他人に復帰の手がかりを渡さない）。
///
/// 表示名（userN）の番号の窓口も兼ねる（issue-71 / ADR 0052）。接続アクターを登録するときに、
/// 空いている一番小さい番号を渡し（番号の選び方は connection/user_number）、接続アクターが
/// どんな終わり方をしても（猶予切れ・退出・復帰で捨てられた・異常終了）、監視の知らせで番号を
/// 空ける。猶予の間は接続アクターが生きているので、番号は取っておかれる。
import gleam/dict.{type Dict}
import gleam/erlang/process.{type Pid, type Subject}
import gleam/otp/actor
import rondo_server/connection/session_actor
import rondo_server/connection/user_number.{type Numbers}

pub opaque type Message {
  Register(token: String, actor: Subject(session_actor.Message), pid: Pid)
  /// 登録して、表示名の番号を渡す（issue-71）。
  RegisterNamed(
    token: String,
    actor: Subject(session_actor.Message),
    pid: Pid,
    reply: Subject(Int),
  )
  Lookup(
    token: String,
    reply: Subject(Result(Subject(session_actor.Message), Nil)),
  )
  /// いま使われている番号（監視・テスト用）。
  NumbersInUse(reply: Subject(List(Int)))
  Down(process.Down)
}

type State {
  State(
    by_token: Dict(String, Subject(session_actor.Message)),
    token_of: Dict(Pid, String),
    /// 表示名の番号（接続アクターのプロセスごと）。
    numbers: Numbers(Pid),
  )
}

pub fn start() -> actor.StartResult(Subject(Message)) {
  actor.new_with_initialiser(1000, fn(self) {
    let selector =
      process.new_selector()
      |> process.select(self)
      |> process.select_monitors(Down)
    State(
      by_token: dict.new(),
      token_of: dict.new(),
      numbers: user_number.new(),
    )
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

/// 接続アクターを登録し、表示名の番号（空いている一番小さい番号）を受け取る。番号は、
/// 接続アクターが止まったときに空く。
pub fn register_named(
  registry: Subject(Message),
  token: String,
  actor: Subject(session_actor.Message),
  pid: Pid,
) -> Int {
  process.call(registry, 1000, RegisterNamed(token, actor, pid, _))
}

/// トークンから接続アクターを引く。
pub fn lookup(
  registry: Subject(Message),
  token: String,
) -> Result(Subject(session_actor.Message), Nil) {
  process.call(registry, 1000, Lookup(token, _))
}

/// いま使われている表示名の番号（小さい順）。
pub fn numbers_in_use(registry: Subject(Message)) -> List(Int) {
  process.call(registry, 1000, NumbersInUse)
}

fn handle(state: State, message: Message) -> actor.Next(State, Message) {
  case message {
    Register(token, subject, pid) ->
      actor.continue(add(state, token, subject, pid))

    RegisterNamed(token, subject, pid, reply) -> {
      let state = add(state, token, subject, pid)
      let #(numbers, number) = user_number.acquire(state.numbers, pid)
      process.send(reply, number)
      actor.continue(State(..state, numbers:))
    }

    Lookup(token, reply) -> {
      process.send(reply, dict.get(state.by_token, token))
      actor.continue(state)
    }

    NumbersInUse(reply) -> {
      process.send(reply, user_number.in_use(state.numbers))
      actor.continue(state)
    }

    Down(process.ProcessDown(pid:, ..)) -> {
      let numbers = user_number.release(state.numbers, pid)
      case dict.get(state.token_of, pid) {
        Ok(token) ->
          actor.continue(State(
            by_token: dict.delete(state.by_token, token),
            token_of: dict.delete(state.token_of, pid),
            numbers:,
          ))
        Error(Nil) -> actor.continue(State(..state, numbers:))
      }
    }

    Down(process.PortDown(..)) -> actor.continue(state)
  }
}

/// 台帳に載せ、プロセスを監視する（同じプロセスは二重に監視しない）。
fn add(
  state: State,
  token: String,
  subject: Subject(session_actor.Message),
  pid: Pid,
) -> State {
  case dict.has_key(state.token_of, pid) {
    True -> Nil
    False -> {
      let _ = process.monitor(pid)
      Nil
    }
  }
  State(
    ..state,
    by_token: dict.insert(state.by_token, token, subject),
    token_of: dict.insert(state.token_of, pid, token),
  )
}
