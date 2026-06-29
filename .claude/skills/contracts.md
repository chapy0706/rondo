# スキル: 契約（contracts）

## いつ使うか

ゲーム・サーバー・クライアントの間でやり取りする型を追加・変更するとき。新しいメッセージ種別を足すときもここ。

## 原則

- 契約は TypeScript を正とする（ADR 0009）。packages/contracts に置く
- ソロ / リアルタイムの2層を型で分ける。SoloGame は接続を持たない（ADR 0004）
- メッセージには多重化の種別を含める（ADR 0007）

## パターン

ゲームの基底と2層（game.ts）:

```ts
export interface Game {
  readonly manifest: GameManifest;
}

export interface SoloGame extends Game {
  readonly kind: "solo";
  // 結果を基盤に返すのみ。RealTimePort を持たない
}

export interface RealtimeGame extends Game {
  readonly kind: "realtime";
  connect(port: RealTimePort): void;
}
```

新しいメッセージ種別を足す手順:

1. packages/contracts/src/messages.ts に種別を追加する（roomId / gameType を含む）
2. server の protocol/message.gleam に対応する型を追加する
3. 対応関係を守るテストを更新する（test.md 参照）

## やってはいけないこと

- Gleam 側を契約の正にする。正は常に TypeScript
- SoloGame に接続や RealTimePort を持たせる
- 種別なしのメッセージを足す。多重化が壊れる
