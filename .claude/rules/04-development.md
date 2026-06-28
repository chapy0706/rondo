<!-- .claude/rules/04-development.md -->

# Development Rules

- UseCase 単位で実装する（Route Handler や Component に業務ロジックを書かない）
- ログ系テーブルは追記のみ。終了時刻の確定以外で UPDATE・DELETE しない
- 副作用（DB 書き込み・外部呼び出し・Realtime 送信）は明示する
- 小さく変更する（1 PR = 1 責務）
- 命名はドメイン用語に一致させる

## 禁止

- 暗黙の仕様を作る
- 一時的な回避コードを残す
- 型を無視する（any で逃げる）
