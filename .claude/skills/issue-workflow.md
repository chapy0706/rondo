# スキル: issue ワークフロー

## いつ使うか

docs/issues/ の issue に着手するとき。実装の最初と最後に必ず通る。

## 手順

1. docs/issues/issue-XX-*.md を読む。スコープ（やること / やらないこと）、受け入れ条件、段階、関連 ADR を把握する
2. 関連 ADR を docs/adr/ で開き、判断の根拠を確認する。スコープ外のことはしない
3. issue の「段階」に沿って実装する。1段階ごとに小さく進める
4. 実装後、`make verify` を通す。これが完了のゲート（TS と Gleam の両方が通ること）
5. 受け入れ条件をすべて満たしているか確認する
6. issue 冒頭のフロントマターを `status: closed` に変え、`closed_at` に日付を入れる

## パターン

issue のフロントマター:

```
---
status: open
created_at: 2026-06-24
closed_at:
---
```

完了時:

```
---
status: open
created_at: 2026-06-24
closed_at: 2026-06-30
---
```

status を closed に変える。未完了一覧は `make issue/list` で確認できる。

## やってはいけないこと

- スコープ外の実装に手を広げる。別の懸念は新しい issue にする
- `make verify` が落ちたまま完了にする
- 受理済み ADR をこの場の都合で書き換える。覆すなら新しい ADR を起こす
