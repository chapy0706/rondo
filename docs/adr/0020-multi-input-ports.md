# ADR 0020: 入力ポートを複数本に扱えるよう拡張する

- ステータス: 受理
- 日付: 2026-09-26

## 文脈

めっちゃカメレオン風ゲームでは、3D空間の自由移動とカメラ操作を同時に行う必要がある。既存の VirtualPad（ADR 0018）は入力ポートを1本しか想定しておらず、`VirtualPadProvider` は単一の `VirtualPadSource` を Context に持つ設計になっている。

## 決定

`InputPort` / `VirtualPadSource` 自体は変更しない。`VirtualPadProvider` と関連フックを、名前付きで複数の入力源を保持できる形に拡張する。既存ゲーム（テトリス等）は名前を省略した従来どおりの呼び出しで動作を維持する。

## 理由

- `VirtualPadSource` は中心からのずれを正規化するだけの純粋なクラスであり、複数本必要なら単純に複数インスタンス化すればよい。ロジックの変更は不要
- 既存ゲームへの影響をゼロに保つため、名前を省略した場合は今までどおりの単一入力として振る舞う後方互換を維持する
- 拡張は Provider と React 層（`virtual-pad.tsx`）に閉じ、`InputPort` という抽象自体は保たれる（ADR 0018 の方針を維持）

## 検討した代替案

- `InputPort` に複数軸を持たせる案。1つのポートが2つの意味（移動と視点）を持つことになり、責務が曖昧になるため却下した

## 結果

- `VirtualPadProvider` は `{ [name: string]: VirtualPadSource }` 相当の複数入力源を保持する
- `useVirtualPad(name?: string)` のように、名前で入力源を選択できるようにする
- カメレオン風ゲームは `useVirtualPad("move")` と `useVirtualPad("look")` の2本を使う
