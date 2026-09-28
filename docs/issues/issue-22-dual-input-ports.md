---
status: open
created_at: 2026-09-27
closed_at:
---

# issue-22: 入力ポートの複数化（移動・視点）

## 背景

めっちゃカメレオン風ゲーム（3D自由移動＋カメラ操作）のため、game-sdk の VirtualPad を複数本扱えるように拡張する。この issue はクライアント側（packages/game-sdk）のみに閉じており、issue-23（サーバー側のメッセージ限定配信）とは独立して着手できる。

## スコープ

### このissueでやること

- `VirtualPadProvider` を、名前付きで複数の入力源を保持できる形に拡張する
- `useVirtualPad(name?: string)` のように、名前で入力源を選べるようにする
- 名前を省略した場合は、既存ゲーム（テトリス・2048・Snake）が今までどおり動作する後方互換を維持する

### このissueでやらないこと

- カメレオン風ゲーム本体の実装（後続issue）
- 加速度センサーなど、VirtualPad 以外の入力源（対象外のまま）

## 設計方針

- `InputPort` / `VirtualPadSource` 自体は変更しない。中心からのずれを正規化する既存ロジックをそのまま複数インスタンス化する（ADR 0020）
- 既存ゲームへの影響をゼロにする。既存の `useVirtualPad()`（引数なし）の挙動は変えない
- 2本目以降は `useVirtualPad("look")` のように名前で引く

## 受け入れ条件

- `useVirtualPad("move")` と `useVirtualPad("look")` が、それぞれ独立した方向入力を返す
- 既存ゲーム（テトリス・2048・Snake）が無改修で動作する（回帰テストで確認）
- `make verify` が通る

## 段階

1. `VirtualPadProvider` を複数入力源対応に拡張する
2. `useVirtualPad(name?)` を実装する
3. 既存ゲームが無改修で動くことを確認する
4. 2本入力のテストを追加する

## 関連

- ADR: 0020
- 独立: issue-23（同時並行で着手可能）
- 後続: カメレオン風ゲーム本体の各issue
