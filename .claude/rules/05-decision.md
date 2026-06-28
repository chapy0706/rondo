<!-- .claude/rules/05-decision.md -->

# Decision Rules

迷った場合は以下の優先順位で判断する:

1. ドメイン仕様（docs/issues・docs/adr）
2. 安全性（データを壊さない・ログは追記のみ）
3. プライバシー（個人特定情報を残さない）
4. シンプルさ（不要な抽象を増やさない）

## 常に確認すること

- 追記のみのログテーブルを UPDATE・DELETE していないか？
- reports・satisfaction_responses に個人特定情報を入れていないか？
- SERVICE_ROLE_KEY をクライアント側に露出していないか？
- 依存方向（Domain への一方向）を破っていないか？
