#!/usr/bin/env bash
# ボット同士の対戦を、ブラウザなしで流す（issue-49）。
#
#   make bots                         # 全シナリオ
#   make bots ARGS="--seed 123"       # 同じ種で再現
#   make bots ARGS="--only 不成立"     # シナリオ名の一部で絞る
#
# - 開発用のサーバー（3000番）と別に、3300番で Gleam サーバーを起動する
# - フェーズ時間を 1/20 に縮める（RONDO_TEST_PHASE_DIVISOR。この起動の間だけ。本番の既定は変えない）
# - 終わったら、サーバーを止める。終了コードは、ボットの結果（全部成功で 0、失敗があれば 1）

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${RONDO_BOTS_PORT:-3300}"
divisor="${RONDO_BOTS_PHASE_DIVISOR:-20}"

set -m
stop_server() {
	if [ -n "${server_pid:-}" ] && kill -0 "$server_pid" 2>/dev/null; then
		kill -TERM -- "-$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}
trap stop_server EXIT INT TERM

if curl -s -o /dev/null "http://localhost:${port}/"; then
	echo "[bots] ${port} 番はすでに使われています。止めてから実行してください" >&2
	exit 2
fi

(cd "$repo_root/server" && RONDO_PORT="$port" RONDO_TEST_PHASE_DIVISOR="$divisor" exec gleam run) &
server_pid=$!

echo "[bots] サーバーの起動を待っています（${port} 番、フェーズ時間 1/${divisor}）"
for _ in $(seq 1 120); do
	if curl -s -o /dev/null "http://localhost:${port}/"; then
		break
	fi
	if ! kill -0 "$server_pid" 2>/dev/null; then
		echo "[bots] サーバーが起動できませんでした" >&2
		exit 2
	fi
	sleep 1
done

set +e
(cd "$repo_root" && RONDO_BOTS_URL="ws://localhost:${port}/ws" pnpm --silent --filter @rondo/bots exec node src/main.ts "$@")
status=$?
set -e
exit "$status"
