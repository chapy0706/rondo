# issue-15: A1 + Coolify デプロイ

## 背景

Phase 1 の死守ラインの最後。フロントと Gleam サーバーを A1 上の Coolify に配置し、Cloudflare Tunnel を通じて公開する。staging への push で自動デプロイされ、外部から遊べる状態にする。

## スコープ

A1 + Coolify + Cloudflare Tunnel に rondo をデプロイする。

### このissueでやること

- フロント（Next.js）と Gleam サーバーを、それぞれ Coolify のサービスとして配置
- Cloudflare Tunnel による公開
- staging / prod の自動デプロイ

### このissueでやらないこと

- 永続データベース（Phase 2）

## 設計方針

- セルフホスト構成として A1 + Coolify + Cloudflare Tunnel を用いる
- A1 は公開 IP を持たないため、外部公開は Cloudflare Tunnel を通す
- フロントと Gleam を別サービスとして配置する（ADR 0011 のモノレポから2サービスをデプロイ）
- staging は開発用、prod は安定後にリーダーがマージ

## 受け入れ条件

- staging へ push するとステージング環境に反映される
- 外部から URL でアクセスして遊べる
- prod へのマージで本番に反映される

## 段階

1. フロントを Coolify サービスとして配置する
2. Gleam サーバーを Coolify サービスとして配置する
3. Cloudflare Tunnel で公開する
4. staging / prod の自動デプロイを繋ぐ

## 関連

- 先行: issue-07 / issue-14
- ADR: 0010 / 0011
