#!/usr/bin/env bash
# 極端に大きな電文で、サーバーが落ちないことを確かめる（issue-51）。
#
#   ./tools/flood.sh                          # 既定（localhost:3300 に自分で立てて 80 MiB の1通）
#   ./tools/flood.sh --size-mb 200            # 大きさを変える
#   ./tools/flood.sh --url ws://host/ws --allow-remote   # 別の接続先（要 --allow-remote）
#
# - 接続先が localhost / 127.0.0.1 のときだけ、そのまま動く。別の接続先に向けるには、
#   --allow-remote を明示する（公開サーバーに負荷をかけうるため、確認の文言を出す）。
# - localhost のときは、開発用のサーバー（3000番）と別に 3300番で Gleam サーバーを立て、
#   終わったら止める。別の接続先のときは、サーバーは立てず、その接続先へ送るだけ。
# - 終了コードは、確認の結果（別の接続が話せれば 0、だめなら 1。使い方の誤りは 2）。

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${RONDO_BOTS_PORT:-3300}"

# --allow-remote を取り除き、残り（--url や --size-mb）は node へ渡す。--url の接続先を控える。
allow_remote=0
url=""
node_args=()
i=1
while [ "$i" -le "$#" ]; do
	arg="${!i}"
	case "$arg" in
		--allow-remote)
			allow_remote=1
			;;
		--url)
			next=$((i + 1))
			url="${!next:-}"
			node_args+=("$arg" "$url")
			i=$next
			;;
		*)
			node_args+=("$arg")
			;;
	esac
	i=$((i + 1))
done

# 接続先のホスト（--url が無ければ、自分で立てる localhost）。
if [ -n "$url" ]; then
	host="$(printf '%s' "$url" | sed -E 's#^wss?://##; s#/.*$##; s#:.*$##')"
else
	host="localhost"
fi

is_local=0
case "$host" in
	localhost | 127.0.0.1 | ::1 | "[::1]") is_local=1 ;;
esac

if [ "$is_local" -ne 1 ] && [ "$allow_remote" -ne 1 ]; then
	echo "[flood] 接続先が localhost ではありません（${host}）。" >&2
	echo "[flood] 別の接続先へ向けるのは、自分の許可されたサーバーだけにしてください。" >&2
	echo "[flood] 意図した確認なら、ARGS に --allow-remote を足してください。" >&2
	exit 2
fi

run_node() {
	# node_args が空でも set -u で落ちないようにする。
	if [ "${#node_args[@]}" -gt 0 ]; then
		(cd "$repo_root" && pnpm --silent --filter @rondo/bots exec node src/flood.ts "${node_args[@]}")
	else
		(cd "$repo_root" && pnpm --silent --filter @rondo/bots exec node src/flood.ts)
	fi
}

if [ "$is_local" -ne 1 ]; then
	echo "[flood] 警告: 別の接続先に、巨大な電文を送ります。"
	echo "[flood] 接続先: ${url}"
	echo "[flood] これはその接続先に負荷をかけます。自分の許可されたサーバーにだけ行ってください。"
	set +e
	run_node
	status=$?
	set -e
	exit "$status"
fi

# ここから localhost: 3300番にサーバーを立てて確かめ、終わったら止める。
set -m
stop_server() {
	if [ -n "${server_pid:-}" ] && kill -0 "$server_pid" 2>/dev/null; then
		kill -TERM -- "-$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}
trap stop_server EXIT INT TERM

if curl -s -o /dev/null "http://localhost:${port}/"; then
	echo "[flood] ${port} 番はすでに使われています。止めてから実行してください" >&2
	exit 2
fi

server_log="$(mktemp -t rondo-flood-log.XXXXXX)"
echo "[flood] サーバーの出力を ${server_log} に取ります"
(cd "$repo_root/server" && RONDO_PORT="$port" exec gleam run) >"$server_log" 2>&1 &
server_pid=$!

echo "[flood] サーバーの起動を待っています（${port} 番）"
for _ in $(seq 1 120); do
	if curl -s -o /dev/null "http://localhost:${port}/"; then
		break
	fi
	if ! kill -0 "$server_pid" 2>/dev/null; then
		echo "[flood] サーバーが起動できませんでした" >&2
		exit 2
	fi
	sleep 1
done

set +e
RONDO_BOTS_URL="${url:-ws://localhost:${port}/ws}" run_node
status=$?
set -e

# 受信プロセスが落ちると、サーバーのログに1行出る（session_actor / heap_guard）。少し待って拾う。
sleep 1
if grep -q "受信プロセスが落ち" "$server_log"; then
	echo "[flood] サーバーのログに『受信プロセスが落ちました』の行: あり"
	grep "受信プロセスが落ち" "$server_log" | head -3
else
	echo "[flood] サーバーのログに『受信プロセスが落ちました』の行: なし"
fi
# OTP が古く、上限が実質効かない場合の起動時の警告も、出ていれば知らせる。
if grep -q "include_shared_binaries を使えません" "$server_log"; then
	echo "[flood] 警告: この OTP では上限が実質効きません（下記）。"
	grep "include_shared_binaries を使えません" "$server_log" | head -1
fi
echo "[flood] サーバーのログの末尾:"
tail -n 15 "$server_log"
exit "$status"
