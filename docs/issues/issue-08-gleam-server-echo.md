# issue-08: Gleam サーバー雛形 + echo

## 背景

リアルタイム基盤の最初の一歩。ルームや接続のロジックに入る前に、Gleam/OTP + mist で WebSocket サーバーが立ち上がり、メッセージを返せる最小状態を作る。A1 上の Docker 開発環境もここで整える。

## スコープ

server/ に Gleam プロジェクトの雛形を作り、echo を実装する。

### このissueでやること

- gleam.toml による Gleam プロジェクトの雛形
- mist による WebSocket サーバーの起動
- 受け取ったメッセージをそのまま返す echo
- A1 上の Docker 開発環境

### このissueでやらないこと

- 接続アクター（issue-09）
- ルームアクター（issue-10）

## 設計方針

- リアルタイム基盤は Gleam/OTP + mist で実装する（ADR 0005）
- nagomi-ws で確立した構成を土台に再利用する

## 受け入れ条件

- WebSocket 接続が確立し、echo が返る
- gleam test が動く最小のテスト雛形がある
- A1 上の Docker で開発・起動できる

## 段階

1. gleam.toml と Gleam プロジェクトの雛形を作る
2. mist で WebSocket サーバーを起動する
3. echo を実装する
4. A1 Docker 開発環境を整える

## 関連

- 先行: issue-02
- ADR: 0005
- 後続: issue-09
