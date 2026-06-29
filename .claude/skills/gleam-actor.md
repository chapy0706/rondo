# スキル: OTP アクターの追加（Gleam）

## いつ使うか

サーバー側に、状態を持つ並行処理の単位を追加するとき。ルーム・接続が代表例。

## 原則

- 1つの関心ごと（1ルーム / 1接続）を1つのアクターに閉じる（ADR 0006）
- 状態はアクター内に持ち、外からはメッセージでのみ操作する
- アクターはスーパーバイザーの下に置き、異常終了からの回復を OTP に委ねる
- 切断は10秒の再接続猶予を扱う（接続アクター、ADR 0013）

## パターン

メッセージ型と状態を定義し、handle でメッセージごとに状態遷移を書く。骨子は次のとおり。

```gleam
import gleam/otp/actor
import gleam/erlang/process.{type Subject}

pub type Message {
  Join(player: PlayerId)
  Leave(player: PlayerId)
  Shutdown
}

type State {
  State(players: List(PlayerId))
}

pub fn start() {
  actor.start(State(players: []), handle_message)
}

fn handle_message(message: Message, state: State) {
  case message {
    Join(player) ->
      actor.continue(State(players: [player, ..state.players]))
    Leave(player) ->
      actor.continue(
        State(players: list.filter(state.players, fn(p) { p != player })),
      )
    Shutdown -> actor.Stop(process.Normal)
  }
}
```

注: gleam_otp の API はバージョンで差がある。実際のシグネチャは nagomi-ws で用いたバージョンと gleam_otp のドキュメントに合わせること。ここで示すのは「状態を閉じ、メッセージで遷移する」という構造の骨子である。

## 配置

- room/room_actor.gleam … 1ルーム = 1プロセス
- room/room_supervisor.gleam … ルームの生成・監視
- connection/connection_actor.gleam … 1接続 = 1プロセス（再接続猶予を持つ）

## やってはいけないこと

- 複数のルームの状態を1つのプロセスに同居させる（障害が波及する。ADR 0006 違反）
- アクターの状態を外から直接書き換える。必ずメッセージ経由にする
- ゲーム固有の勝敗判定をアクターの共通部分に混ぜる。それは server/src/games/<id>/ に置く
