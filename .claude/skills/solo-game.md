# スキル: ソロゲームの追加

## いつ使うか

通信を必要としないゲーム（テトリス、2048 等）を追加するとき。

## 原則

- SoloGame として実装し、リアルタイム接続を受け取らない（ADR 0004）
- 入力は基盤共通の VirtualPad を使う（ADR 0018）。入力元を自前で持たない
- マニフェストで自己記述し、registry に登録する（ADR 0003）
- 基盤の UI・ルーティングには手を入れない

## 手順

1. apps/web/src/games/<id>/ を作る
2. manifest.ts を書く（kind: "solo"）
3. game-sdk の useSoloGame と useVirtualPad を使ってゲーム本体を実装する
4. games/registry.ts にマニフェストを登録する

## パターン

マニフェスト:

```ts
// games/tetris/manifest.ts
import type { GameManifest } from "@rondo/contracts";

export const tetrisManifest: GameManifest = {
  id: "tetris",
  title: "Tetris",
  kind: "solo",
  minPlayers: 1,
  maxPlayers: 1,
  thumbnail: "/games/tetris.png",
  description: "落ちものパズル",
  orientation: "portrait",
};
```

ゲーム本体（入力と結果返却は SDK 経由）:

```tsx
const { x, y } = useVirtualPad();       // 方向入力。入力元は知らない
const { reportResult } = useSoloGame(tetrisManifest);

// ゲーム終了時
reportResult({ score });
```

registry 登録:

```ts
// games/registry.ts
import { tetrisManifest } from "./tetris/manifest";

export const registry = [tetrisManifest /*, ... */];
```

## やってはいけないこと

- RealTimePort や WebSocket をソロゲームに持ち込む（ADR 0004 違反）
- 加速度センサーや独自の入力を直に触る。VirtualPad を通す
- 選択画面や基盤側を改修する。追加は games/ と registry だけで完結させる
