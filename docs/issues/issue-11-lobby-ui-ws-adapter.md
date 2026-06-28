# issue-11: ルーム・ロビーUI + WebSocketAdapter

## 背景

フロントとリアルタイム基盤を繋ぐ。ロビーでルーム一覧の表示と新規作成を行い、クライアント側で単一接続を多重化する WebSocketAdapter を用意する。サーバーなしで開発できるよう Mock も併せて作る。このissueは契約（issue-04）とルーム基盤（issue-10）の両方を待つ。

## スコープ

apps/web に、ロビーUIと WebSocketAdapter を実装する。

### このissueでやること

- ロビーUI（ルーム一覧の表示、新規作成）
- WebSocketAdapter（単一接続を多重化して各機能に配る）
- MockWebSocketAdapter（サーバーなしでの開発用）

### このissueでやらないこと

- ゲームの描画・進行（issue-12）

## 設計方針

- ルーム参加は一覧からの参加または新規作成とする（ADR 0016）
- WebSocket 接続は1本とし、メッセージの種別で多重化する（ADR 0007）
- Mock を用意し、フロントがサーバーの完成を待たずに開発できるようにする

## 受け入れ条件

- ルーム一覧が表示され、参加・新規作成ができる
- WebSocketAdapter が単一接続を多重化して各機能に配る
- MockWebSocketAdapter でサーバーなしの開発ができる

## 段階

1. WebSocketAdapter と Mock を実装する
2. ロビーUI（一覧・新規作成）を実装する
3. ルーム基盤と接続して動作確認する

## 関連

- 先行: issue-04 / issue-10
- ADR: 0016 / 0007
- 後続: issue-12
