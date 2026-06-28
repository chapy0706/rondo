<!-- .claude/rules/02-security.md -->

# Security Rules（短い）

- .env / keys / tokens / secrets を読まない、ログに出さない、コミットしない
- SUPABASE_SERVICE_ROLE_KEY をクライアント側コードで参照しない（サーバ側限定）
- 認可は RLS に集約する。アプリ側のチェックは多層防御の補助と考える
- reports・satisfaction_responses に個人特定情報を持ち込まない（匿名性をスキーマで守る）
- 破壊的コマンドは禁止（rm -rf / git reset --hard / force push）
- 外部ネットワークアクセスは原則しない（必要なら人間確認）
- 迷ったら安全側（deny）に倒す
