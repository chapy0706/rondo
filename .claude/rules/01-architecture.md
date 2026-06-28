<!-- .claude/rules/01-architecture.md -->

# Architecture Rules（短い）

- 依存方向は Presentation -> Application -> Domain。Infrastructure は Domain の Port を実装する
- Domain は他のどの層にも依存しない（フレームワーク非依存の純粋な TypeScript）
- 境界（HTTP・DB・Realtime・外部 API）で unknown を Zod parse する（型の嘘を通さない）
- UI（Next.js / RSC / Client Component）は Domain に侵入しない
- ログ系テーブルは追記のみ。アプリから UPDATE・DELETE しない（終了時刻の確定を除く）
- 変更は小さく。影響範囲を言語化する（安全性 / 変更容易性 / 性能 / 運用）
