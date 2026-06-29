# next-gleam skills

rondo（Next.js + Gleam モノレポ）の実装パターン集。Claude Code が issue を実装するときに参照する。

各スキルは「いつ使うか」「手順」「パターン（コード）」「やってはいけないこと」で構成する。設計判断の根拠は docs/adr/ にあり、各スキルから該当 ADR を参照する。

## 一覧

| スキル | いつ使うか |
| ------ | ---------- |
| issue-workflow.md | issue を読み、実装し、完了させるとき（最初に読む） |
| contracts.md | 契約（型・メッセージ）を追加・変更するとき |
| solo-game.md | ソロゲームを追加するとき |
| realtime-game.md | リアルタイムゲームを追加するとき |
| gleam-actor.md | サーバー側に OTP アクターを追加するとき |
| react-component.md | フロントの画面・コンポーネントを作るとき |
| test.md | テストを書くとき |

## 全スキル共通の原則

- ドメインと契約（contracts）が中心。外部に依存させない（Clean Architecture）
- 各モジュールは単一の責任を持ち、小さく繋ぐ（UNIX 哲学）
- 必要なものだけ繋ぐ。ソロゲームに通信の都合を持ち込まない（ADR 0004）
- 受理済み ADR は書き換えない。設計を変えるときは新しい ADR を起こす（ADR 0001）
