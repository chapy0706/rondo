#!/usr/bin/env bash
# 実接続の開発環境を、1コマンドで起動する（issue-48）。
#
#   make dev-all
#
# - Gleam サーバー: ws://localhost:3000/ws（ポートは server/src/rondo_server.gleam で固定）
# - web（Next.js の開発サーバー）: http://localhost:3100。WebSocket の URL はこのスクリプトが渡す
# - Ctrl-C（または片方が止まる）で、両方を止める
#
# 子プロセスはそれぞれ別のプロセスグループで起こし、止めるときはグループごと止める
# （gleam run が起こす Erlang の VM や、next dev の子プロセスを取り残さないため）。

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_port=3000
web_port="${RONDO_WEB_PORT:-3100}"
ws_url="ws://localhost:${server_port}/ws"

# ジョブ制御を有効にし、バックグラウンドのジョブに自分のプロセスグループを持たせる。
set -m

stop_all() {
	trap - EXIT INT TERM
	echo ""
	echo "[dev-all] 止めています"
	for pid in "${server_pid:-}" "${web_pid:-}"; do
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			kill -TERM -- "-$pid" 2>/dev/null || true
		fi
	done
	wait 2>/dev/null || true
}
trap stop_all EXIT INT TERM

(cd "$repo_root/server" && exec gleam run) &
server_pid=$!

(cd "$repo_root" && NEXT_PUBLIC_RONDO_WS_URL="$ws_url" exec pnpm --filter @rondo/web exec next dev --port "$web_port") &
web_pid=$!

echo "[dev-all] server: ${ws_url}"
echo "[dev-all] web:    http://localhost:${web_port}（実接続）"
echo "[dev-all] Ctrl-C で両方を止めます"

# どちらかが止まったら、もう片方も止める（bash 3.2 でも動くよう、wait -n は使わない）。
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
	sleep 1
done
echo "[dev-all] 片方が止まりました"
