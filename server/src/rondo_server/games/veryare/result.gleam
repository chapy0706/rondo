/// veryare の勝敗を、基盤の結果（順位）へ写す（issue-42）。
///
/// 勝敗は状態機械（game）の終了遷移が決めたものをそのまま使い、ここでは判定しない。
/// 勝ちを 1 位（score 1）、負けを 2 位（score 0）とし、同じ順位を複数人で共有する。
/// 隠れ側はチームとして扱い、隠れ側の勝ちなら、見つかった人も 1 位にする。逃げ切ったか
/// どうかは「状態」で区別する。不成立は全員 1 位・score 0 とする。
///
/// 答え合わせタイム（ADR 0033）で全員の位置は公開済みなので、誰が逃げ切ったかは全員へ
/// 送ってよい（ADR 0021）。見逃しポイント・いいね（ADR 0036）は issue-32 で足す。
import gleam/list
import gleam/option.{Some}
import gleam/set
import rondo_server/games/veryare/game.{
  type Game, type Outcome, Ended, HidersWin, NotEnoughPlayers, OniWins,
}
import rondo_server/protocol/message.{type ScoreOrder, HigherIsBetter}
import rondo_server/room/driver.{type Standing, Standing}

/// 終了していれば、順位の並びと結果の行。終了前（答え合わせ中を含む）は Error。
/// 行は 1 位から順に、同じ順位の中は参加順に並べる。
pub fn of(game: Game(id)) -> Result(#(ScoreOrder, List(Standing(id))), Nil) {
  case game.phase {
    Ended(outcome) -> Ok(#(HigherIsBetter, standings(game, outcome)))
    _ -> Error(Nil)
  }
}

fn standings(game: Game(id), outcome: Outcome) -> List(Standing(id)) {
  case outcome, game.oni {
    NotEnoughPlayers, _ ->
      list.map(game.players, fn(id) {
        Standing(player: id, rank: 1, score: 0, details: [#("結果", "不成立")])
      })
    _, Some(oni) -> {
      let hiders = list.filter(game.players, fn(id) { id != oni })
      let oni_won = outcome == OniWins
      let oni_row = row(oni, oni_won, [#("役割", "鬼")], [])
      let hider_rows =
        list.map(hiders, fn(id) {
          let status = case set.contains(game.still_hiding, id) {
            True -> "逃げ切り"
            False -> "発見・失格・離脱"
          }
          row(id, outcome == HidersWin, [#("役割", "隠れる側")], [
            #("状態", status),
          ])
        })
      case oni_won {
        True -> [oni_row, ..hider_rows]
        False -> list.append(hider_rows, [oni_row])
      }
    }
    // 鬼が決まらずに勝敗が付くことは状態機械に無い。念のため誰も並べない。
    _, _ -> []
  }
}

fn row(
  id: id,
  won: Bool,
  before: List(#(String, String)),
  after: List(#(String, String)),
) -> Standing(id) {
  let #(rank, score, label) = case won {
    True -> #(1, 1, "勝ち")
    False -> #(2, 0, "負け")
  }
  Standing(
    player: id,
    rank:,
    score:,
    details: list.flatten([before, [#("結果", label)], after]),
  )
}
