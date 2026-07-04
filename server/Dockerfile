# rondo リアルタイム基盤（Gleam/OTP + mist）のイメージ。
#
# ビルドと実行を分ける。ビルド段でツールチェインを使って erlang-shipment を作り、
# 実行段には成果物だけを載せる。実行段も同じ Gleam 公式イメージを土台にすることで
# OTP のバージョン差でずれないようにする。A1 上の Docker で開発・起動できる（issue-08）。

FROM ghcr.io/gleam-lang/gleam:v1.17.0-erlang-alpine AS build

WORKDIR /build

# 依存だけ先に解決してレイヤーをキャッシュする
COPY gleam.toml manifest.toml ./
RUN gleam deps download

COPY src ./src
COPY test ./test
RUN gleam export erlang-shipment

FROM ghcr.io/gleam-lang/gleam:v1.17.0-erlang-alpine

WORKDIR /app
COPY --from=build /build/build/erlang-shipment ./

# WebSocket サーバーの待ち受けポート（src の port 定数と一致させる）
EXPOSE 3000

CMD ["./entrypoint.sh", "run"]
