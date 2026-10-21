/// 観戦ルームの長めの確認（issue-67 段階 ⑤）。観戦ルームを、時間を縮めて（既定 1/100）、連続の試合で
/// 回し続け、1 分ごとに、プロセスの数・ルームのメモリ（ごみ集めのあと）・全体のメモリ・観戦者への通知の
/// 間隔を表で出す。最後に、増え続けたり、乱れたりしていないかを判定する（problems）。
///
///   cd server && RONDO_SOAK_MINUTES=30 gleam run -m rondo_server/spectate_soak
///
/// - サーバーを立てず、ルーム（room_actor）を直接動かす（接続の層は通さない。観戦者は、送信先を持つ
///   プロセス 20 個）
/// - 環境変数: RONDO_SOAK_MINUTES（回す分。既定 30）、RONDO_SOAK_DIVISOR（時間を縮める割合。既定 100）
/// - 観戦用の通知の間隔（100 ms）は縮めない。通知の間隔は、同じ試合の中の、全員宛ての通知の間で測る
/// - 終了コード: 問題が無ければ 0、あれば 1
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/erlang/process.{type Pid, type Subject}
import gleam/int
import gleam/io
import gleam/list
import gleam/result
import gleam/string
import rondo_server/games/timing
import rondo_server/games/veryare/game
import rondo_server/games/veryare/room.{RandomLayout, SpectateSettings} as veryare
import rondo_server/protocol/message.{type ServerMessage, GameStarted, GameState}
import rondo_server/room/room_actor.{Player, PlayerId, RoomId, Spectate}

const spectators = 20

const hider_cpus = 4

/// 1 分ごとの行。
pub type SoakRow {
  SoakRow(
    minute: Int,
    /// ここまでに始まった試合の数（観戦者 1 人目が受け取った game-started）。
    games: Int,
    processes: Int,
    /// ルームのプロセスのメモリ（KiB。ごみ集めのあと）。
    room_kb: Int,
    total_kb: Int,
    /// この 1 分に、観戦者 20 人が受け取った観戦用の通知の数。
    notices: Int,
    gap_min_ms: Int,
    gap_p50_ms: Int,
    gap_p95_ms: Int,
    gap_max_ms: Int,
  )
}

/// 行から、増え続けたり、乱れたりしているところを並べる。空なら問題なし。
/// - プロセスの数: 最後の分が、最初の分より 10 以上多い
/// - ルームのメモリ: 最後の分が、最初の分の 2 倍を超える
/// - 通知の間隔: どの分でも、最小が 80 ms 未満（100 ms より明らかに短い）か、中央の値が、最初の分から
///   大きくずれる（1.5 倍 + 20 ms を超えるか、2/3 - 20 ms を下回る）。時間を縮めると、隠れ CPU は歩かず
///   （準備移動が短い）、通知は主に鬼 CPU の 0.5 秒ごとの歩きで出るので、中央の値は 100 ms より長い
pub fn problems(rows: List(SoakRow)) -> List(String) {
  case rows, list.last(rows) {
    [first, ..], Ok(last) ->
      list.flatten([
        case last.processes - first.processes >= 10 {
          True -> [
            "プロセスの数が増えた（"
            <> int.to_string(first.processes)
            <> " → "
            <> int.to_string(last.processes)
            <> "）",
          ]
          False -> []
        },
        case last.room_kb > first.room_kb * 2 {
          True -> [
            "ルームのメモリが増えた（"
            <> int.to_string(first.room_kb)
            <> " KiB → "
            <> int.to_string(last.room_kb)
            <> " KiB）",
          ]
          False -> []
        },
        list.flat_map(rows, fn(row) {
          let at = int.to_string(row.minute) <> " 分目: "
          list.flatten([
            case row.gap_min_ms < 80 {
              True -> [
                at
                <> "通知の間隔が短すぎる（最小 "
                <> int.to_string(row.gap_min_ms)
                <> " ms）",
              ]
              False -> []
            },
            case
              row.gap_p50_ms > first.gap_p50_ms * 3 / 2 + 20
              || row.gap_p50_ms < first.gap_p50_ms * 2 / 3 - 20
            {
              True -> [
                at
                <> "通知の間隔の中央の値が、最初の分（"
                <> int.to_string(first.gap_p50_ms)
                <> " ms）からずれた（"
                <> int.to_string(row.gap_p50_ms)
                <> " ms）",
              ]
              False -> []
            },
          ])
        }),
      ])
    _, _ -> ["測った行が無い"]
  }
}

// --- 観戦者のプロセス --------------------------------------------------------------

/// 観戦者への頼みごと: いままでの数と、前の報告からの通知の間隔を返して、間隔を空にする。
type Ask {
  Report(reply: Subject(#(Int, Int, List(Int))))
}

type Event {
  Got(ServerMessage)
  Asked(Ask)
}

/// 観戦者 1 人。ルームに観戦者として入り、受け取った観戦用の通知の時刻を数え続ける。
fn spectator(
  room: Subject(room_actor.Message),
  n: Int,
  ready: Subject(Subject(Ask)),
) -> Pid {
  process.spawn(fn() {
    let outbox = process.new_subject()
    let asks = process.new_subject()
    let id = "soak-" <> int.to_string(n)
    let assert Ok(Nil) =
      room_actor.join_and_subscribe(room, Player(PlayerId(id), id), outbox)
    process.send(ready, asks)
    let selector =
      process.new_selector()
      |> process.select_map(outbox, Got)
      |> process.select_map(asks, Asked)
    listen(selector, Error(Nil), 0, 0, [])
  })
}

fn listen(
  selector: process.Selector(Event),
  last: Result(Int, Nil),
  notices: Int,
  games: Int,
  gaps: List(Int),
) -> Nil {
  case process.selector_receive_forever(selector) {
    Got(GameStarted(..)) ->
      listen(selector, Error(Nil), notices, games + 1, gaps)
    Got(GameState(payload:, ..)) ->
      case is_spectate(payload) {
        True -> {
          let now = monotonic_ms()
          let gaps = case last {
            Ok(at) -> [now - at, ..gaps]
            Error(Nil) -> gaps
          }
          listen(selector, Ok(now), notices + 1, games, gaps)
        }
        False -> listen(selector, last, notices, games, gaps)
      }
    Got(_) -> listen(selector, last, notices, games, gaps)
    Asked(Report(reply)) -> {
      process.send(reply, #(notices, games, gaps))
      listen(selector, last, notices, games, [])
    }
  }
}

fn is_spectate(payload: Dynamic) -> Bool {
  decode.run(payload, decode.at(["type"], decode.string)) == Ok("spectate")
}

fn numbers(from: Int, to: Int) -> List(Int) {
  case from > to {
    True -> []
    False -> [from, ..numbers(from + 1, to)]
  }
}

// --- 本体 --------------------------------------------------------------------------

pub fn main() -> Nil {
  let minutes = env_int("RONDO_SOAK_MINUTES", 30)
  let divisor = env_int("RONDO_SOAK_DIVISOR", 100)
  let pace = timing.Faster(divisor:)
  let spec =
    veryare.spectate_spec_with(
      RoomId("soak"),
      SpectateSettings(
        hider_cpus,
        veryare.spectate_default_exploration_seconds,
        RandomLayout,
      ),
      game.durations(
        exploration_ms: veryare.spectate_default_exploration_seconds * 1000,
      )
        |> timing.apply(pace),
      int.random,
      monotonic_ms,
    )
  let assert Ok(started) =
    room_actor.start_with(spec, Spectate(veryare.spectate_config(pace)))
  let room = started.data
  let ready = process.new_subject()
  list.each(numbers(1, spectators), fn(n) { spectator(room, n, ready) })
  let asks =
    list.map(numbers(1, spectators), fn(_) {
      let assert Ok(asks) = process.receive(ready, 5000)
      asks
    })
  let assert Ok(Nil) = room_actor.start_game(room)
  io.println(
    "観戦ルームの長めの確認（観戦者 "
    <> int.to_string(spectators)
    <> " 人、隠れ CPU "
    <> int.to_string(hider_cpus)
    <> " 体、時間 1/"
    <> int.to_string(divisor)
    <> "、"
    <> int.to_string(minutes)
    <> " 分）",
  )
  io.println(
    "| 分 | 試合 | プロセス | ルーム KiB | 全体 KiB | 通知 | 間隔の最小 | 中央 | 95% | 最大 |",
  )
  io.println("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  let rows =
    list.map(numbers(1, minutes), fn(minute) {
      process.sleep(60_000)
      let reports = list.map(asks, fn(ask) { process.call(ask, 5000, Report) })
      let row = row_of(minute, reports, started.pid)
      io.println(format(row))
      row
    })
  let found = problems(rows)
  room_actor.dissolve(room)
  io.println("")
  case found {
    [] -> {
      io.println("問題: 0 件")
      halt(0)
    }
    _ -> {
      io.println("問題: " <> int.to_string(list.length(found)) <> " 件")
      list.each(found, fn(p) { io.println("  - " <> p) })
      halt(1)
    }
  }
}

/// 観戦者の報告（いままでの通知の数・試合の数・この 1 分の間隔）から、1 分の行を作る。通知の数は、
/// 前の分との差ではなく、この 1 分の間隔の数 + 試合の切れ目で数える（簡単のため、間隔の数を使う）。
fn row_of(
  minute: Int,
  reports: List(#(Int, Int, List(Int))),
  room_pid: Pid,
) -> SoakRow {
  let gaps = list.flat_map(reports, fn(r) { r.2 }) |> list.sort(int.compare)
  let at = fn(p: Int) {
    case gaps {
      [] -> 0
      _ -> {
        let index = { list.length(gaps) - 1 } * p / 100
        list.drop(gaps, index) |> list.first |> result.unwrap(0)
      }
    }
  }
  let games = case reports {
    [#(_, games, _), ..] -> games
    [] -> 0
  }
  SoakRow(
    minute:,
    games:,
    processes: process_count(),
    room_kb: memory_after_gc(room_pid) / 1024,
    total_kb: total_memory() / 1024,
    notices: list.length(gaps),
    gap_min_ms: at(0),
    gap_p50_ms: at(50),
    gap_p95_ms: at(95),
    gap_max_ms: at(100),
  )
}

fn format(row: SoakRow) -> String {
  "| "
  <> string.join(
    list.map(
      [
        row.minute,
        row.games,
        row.processes,
        row.room_kb,
        row.total_kb,
        row.notices,
        row.gap_min_ms,
        row.gap_p50_ms,
        row.gap_p95_ms,
        row.gap_max_ms,
      ],
      int.to_string,
    ),
    " | ",
  )
  <> " |"
}

fn env_int(name: String, default: Int) -> Int {
  get_env(name) |> result.try(int.parse) |> result.unwrap(default)
}

@external(erlang, "rondo_server_ffi", "get_env")
fn get_env(name: String) -> Result(String, Nil)

@external(erlang, "rondo_server_ffi", "monotonic_ms")
fn monotonic_ms() -> Int

@external(erlang, "rondo_soak_ffi", "process_count")
fn process_count() -> Int

@external(erlang, "rondo_soak_ffi", "memory_after_gc")
fn memory_after_gc(pid: Pid) -> Int

@external(erlang, "rondo_soak_ffi", "total_memory")
fn total_memory() -> Int

@external(erlang, "erlang", "halt")
fn halt(status: Int) -> Nil
