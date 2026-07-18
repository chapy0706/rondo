# rondo フロント（Next.js）の本番イメージ（issue-15）。
#
# pnpm ワークスペースのモノレポ（ADR 0011）から web だけを本番ビルドする。
# ビルド段で standalone 出力（next.config の output: "standalone"）を作り、実行段には
# その最小成果物だけを載せてイメージを薄く保つ。ビルドコンテキストはリポジトリのルート。
# Coolify では「Base Directory = リポジトリ直下」「Dockerfile = apps/web/Dockerfile」に設定する。

# ---- 依存の解決とビルド ----
FROM node:22-slim AS builder

# pnpm は package.json の packageManager 指定に従わせる（corepack）。
RUN corepack enable
WORKDIR /repo

# まず各パッケージのマニフェストだけを入れて依存レイヤーをキャッシュする。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/game-sdk/package.json ./packages/game-sdk/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

# ソースを入れてビルド。
COPY . .

# NEXT_PUBLIC_* はビルド時にコードへ埋め込まれる。未指定なら Mock 動作（サーバー不要）。
# リアルタイム基盤（Gleam）に繋ぐ場合は wss://<server-host>/ws を Coolify のビルド変数で渡す。
ARG NEXT_PUBLIC_RONDO_WS_URL=""
ENV NEXT_PUBLIC_RONDO_WS_URL=$NEXT_PUBLIC_RONDO_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @rondo/web build

# ---- 実行 ----
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# root 以外で動かす（イメージ同梱の node ユーザー）。
USER node

# standalone 一式 + 静的アセット + public を配置する。
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

EXPOSE 3000

# standalone のエントリ。server.js が PORT/HOSTNAME を見て待ち受ける。
CMD ["node", "apps/web/server.js"]
