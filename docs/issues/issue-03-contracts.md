# issue-03: contracts パッケージ

## 背景

contracts は、サーバー・クライアント・ゲームの間でやり取りする型の取り決めであり、全パッケージが参照する中心である。ここを最初に固めることで、以降の実装が同じ型の上で進められる。とくにメンバーが担当するソロゲームや基盤UIは、この契約が出てから着手できる。契約はメンバーのレーンを動かす起点になる。

## スコープ

packages/contracts に、契約の型を TypeScript で定義する。

### このissueでやること

- Game / SoloGame / RealtimeGame インターフェース（game.ts）
- GameManifest 型（manifest.ts）
- WebSocketメッセージ契約（messages.ts）。多重化のための種別を含む
- スコア・結果の共通型（result.ts）

### このissueでやらないこと

- 各ゲームや基盤の実装ロジック（後続 issue で対応）
- Gleam 側 protocol との対応付け（issue-08 以降で対応）

## 設計方針

- 契約は TypeScript を正とする（ADR 0009）
- ソロ / リアルタイムの2層を型で分ける。SoloGame は RealTimePort を持たない（ADR 0004）
- メッセージには多重化の種別（gameType / roomId 等）を含める（ADR 0007）

## 受け入れ条件

- 上記4種の型が packages/contracts から export される
- web / game-sdk から型を import して型チェックが通る
- SoloGame と RealtimeGame の差（接続の有無）が型で表現されている

## 段階

1. game.ts に Game / SoloGame / RealtimeGame を定義する
2. manifest.ts に GameManifest を定義する
3. messages.ts にメッセージ契約を定義する
4. result.ts に結果型を定義する

## 関連

- 先行: issue-02
- ADR: 0009 / 0004 / 0007
- 後続: issue-04 / issue-06
