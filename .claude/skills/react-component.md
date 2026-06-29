# スキル: React コンポーネント

## いつ使うか

フロントの画面やコンポーネントを作るとき。基盤UI（TOP・選択・ロビー・結果）と、各ゲームのUIの両方。

## 原則

- スマホの縦画面・タッチ操作を基本とする（ADR 0012）
- 基盤UIはゲームに依存しない。ゲーム固有のUIは games/<id>/ に閉じる
- Zustand はフロントの UI 状態のみを持つ。ドメインの状態をここに置かない
- 選択画面は registry のマニフェストから自動生成する。ゲームをハードコードしない（ADR 0003）

## パターン

- 基盤UI: apps/web/src/platform/ に置く（select / lobby / result）
- ゲームUI: apps/web/src/games/<id>/ に置く
- 状態: apps/web/src/store/ に Zustand ストア（selectStore / gameUIStore など）
- リアルタイム通信は WebSocketAdapter 経由。コンポーネントから直に WebSocket を触らない

選択画面はマニフェストを舐めてカードを並べるだけにする。新しいゲームが増えても、選択画面のコードは変えない。

## やってはいけないこと

- 選択画面にゲーム名を直書きする（ADR 0003 違反）
- コンポーネントから直接 WebSocket を開く。Adapter を通す（ADR 0007）
- UI ストアにドメインの真実（順位・権威的な状態）を持たせる。それはサーバーが持つ
