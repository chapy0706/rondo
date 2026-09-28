---
status: closed
created_at: 2026-09-27
closed_at: 2026-09-28
---

# issue-19: czz 採点エンジンとお題データの取り込み

## 背景

czz（Linux コマンド学習アプリ）を rondo のソロゲームとして載せる。czz 本体は Payload 相当の自前 CMS・Postgres・Clerk 認証を伴うフルスタック構成だが、調査（docs/czz-inventory.md）により、演習を解く体験そのものはこれらを必要としないことが判明した。

- 採点ロジックの核 `packages/dsl-core/src/{execute,testRunner,schema}.ts` は Zod のみに依存する純粋な JS で、ブラウザ内で完結できる
- API 往復が必要な理由は「テストケースを DB から取得」「結果を DB 保存」「Clerk ユーザー解決」の3点のみで、採点計算自体はサーバー・クライアント共通の純粋関数
- お題データは Postgres の tasks テーブルに JSONB で入っているが、実データは `seed_insert.sql` に20問ベタ書きで内容は完全に静的

rondo は Phase 1 で永続化を持たず（ADR 0019）、認証も持たない（ADR 0015）。czz から剥がすべきもの（DB・認証・API 往復）と、rondo が持たないと決めたものが一致している。

本 issue では、czz の「核」だけを rondo に取り込む。UI の移植と registry 登録は後続 issue で行う。

## スコープ

### このissueでやること

- `dsl-core` の採点ロジック（execute / testRunner / schema）を rondo に取り込む
- `seed_insert.sql` の20問を静的な TS/JSON データに変換する
- 取り込んだ採点ロジックが、DB・API・認証なしで単体で動くことをテストで確認する

### このissueでやらないこと

- ゲーム UI の実装（issue-20）
- registry 登録とプラグイン化（issue-20）
- 既存の CommandBuilder など czz の UI 資産の移植（issue-21）
- 進捗保存・アカウント機能（rondo では持たない）

## 設計方針

- 取り込む対象は純粋関数とデータのみとする。fetch・DB アクセス・認証への依存を一切持ち込まない
- お題データは静的データとして持つ。DB を前提にしない（ADR 0019）
- 採点は判定ロジックであり、テストで守る。czz 側に既存テストがあれば併せて移植する
- 配置は packages/ に置くか games 配下に閉じるかを実装時に判断する。rondo の他ゲームから参照されないなら games 配下に閉じてよい（一ゲームの内部都合を共有パッケージに昇格させない）

## 受け入れ条件

- 採点ロジックが rondo 内で import でき、型チェックが通る
- お題20問が静的データとして参照でき、DB を必要としない
- 「コマンド文字列とお題を渡すと採点結果が返る」ことがテストで確認できる
- 取り込んだコードが fetch・DB・認証に依存していない
- `make verify` が通る

## 段階

0. czz のリポジトリを rondo 内の `.reference/czz/` に一時的に clone する（参照専用、rondo の履歴には残さない）

   ```bash
   git clone <czzのリポジトリURL> .reference/czz --depth 1
   echo ".reference/" >> .gitignore
   ```

   以降の作業では `.reference/czz/` を読み取り専用の参照として扱い、中身を書き換えない。取り込みが終わったら `.reference/czz/` は削除する（`rm -rf .reference/czz`）。

1. `.reference/czz/packages/dsl-core` から execute / testRunner / schema を読み、rondo 側（`games/czz/` 配下、または packages/ 配下）に書き写す
2. Zod の依存関係を rondo 側に揃える
3. `.reference/czz/`（seed_insert.sql）の20問を、静的データ（TS/JSON）に変換して rondo 側に書き写す
4. 採点が単体で動くことをテストで確認する
5. `.reference/czz/` を削除する

## 関連

- 調査: docs/czz-inventory.md
- ADR: ADR 0019（永続化しない）/ 0015（永続アカウントを持たない）/ 0004（ソロゲーム）
- 後続: issue-20
