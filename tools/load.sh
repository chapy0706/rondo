#!/usr/bin/env bash
# 負荷・長時間・乱れた通信・不正な入力の試験（issue-51）。ブラウザを使わず、ボットの仕組みで動かす。
#
#   ./tools/load.sh limits                    # 上限（同時ルーム数3・定員5人・空きが戻ること）
#   ./tools/load.sh load [--seconds 20]       # 3ルーム × 5人の同時負荷（待機ルームの同期を含む）
#   ./tools/load.sh chaos [--rounds 20]       # 乱れた通信（切断と復帰、猶予切れ、他人のトークン）
#   ./tools/load.sh garbage                   # 不正な入力（壊れた JSON・未知の種別・バイナリ・大量送信）
#   ./tools/load.sh soak [--minutes 60]       # 長時間の放置（待機ルームで、つなぎ続ける）
#   ./tools/load.sh join [--only 鬼 CPU]      # 参加・復帰の組み合わせ表（途中参加の人に、いまの状態が届くか）
#   ./tools/load.sh spectate [--seconds 20]   # 観戦ルーム（観戦者 20 人）と人間の 3 ルーム × 5 人を同時に（issue-67）
#
# - 開発用のサーバー（3000番）と別に、3300番で Gleam サーバーを起動し、終わったら止める
#   （tools/bots.sh と同じ）。フェーズ時間は 1/20 に縮める（再接続猶予とハートビートは縮まない）
#   広い屋敷だけ（stage 3）を受け付ける（RONDO_WIDE_DEV=1。join の広い屋敷の構成 / issue-65）
#   観戦ルームを受け付ける（RONDO_SPECTATE_DEV=1。spectate / issue-67。ほかの試験は観戦ルームを作らない）
# - サーバーのプロセス（待ち受けのポートのプロセス）を調べて、RONDO_SERVER_PID で試験へ渡す。
#   試験は、ps で RSS と CPU を読む
# - サーバーの出力は一時ファイルに取り、終わったら、落ちた・警告の行の有無と末尾を出す
# - 本番に向けては使わない（本番での確かめは docs/load-tests.md の手順に従い、人が判断する）
# - 終了コードは、試験の結果（全部通れば 0、失敗があれば 1。使い方の誤り・起動の失敗は 2）

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${RONDO_BOTS_PORT:-3300}"
divisor="${RONDO_BOTS_PHASE_DIVISOR:-20}"

kind="${1:-}"
case "$kind" in
	limits | load | chaos | garbage | soak | join | spectate) shift ;;
	*)
		echo "使い方: ./tools/load.sh limits|load|chaos|garbage|soak|join|spectate [引数]" >&2
		exit 2
		;;
esac

set -m
# shellcheck disable=SC2329  # trap から間接的に呼ばれる
stop_server() {
	if [ -n "${server_pid:-}" ] && kill -0 "$server_pid" 2>/dev/null; then
		kill -TERM -- "-$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}
trap stop_server EXIT INT TERM

if curl -s -o /dev/null "http://localhost:${port}/"; then
	echo "[load] ${port} 番はすでに使われています。止めてから実行してください" >&2
	exit 2
fi

server_log="$(mktemp -t rondo-load-log.XXXXXX)"
echo "[load] サーバーの出力を ${server_log} に取ります"
(cd "$repo_root/server" && RONDO_PORT="$port" RONDO_TEST_PHASE_DIVISOR="$divisor" RONDO_WIDE_DEV=1 RONDO_SPECTATE_DEV=1 exec gleam run) >"$server_log" 2>&1 &
server_pid=$!

echo "[load] サーバーの起動を待っています（${port} 番、フェーズ時間 1/${divisor}）"
for _ in $(seq 1 120); do
	if curl -s -o /dev/null "http://localhost:${port}/"; then
		break
	fi
	if ! kill -0 "$server_pid" 2>/dev/null; then
		echo "[load] サーバーが起動できませんでした" >&2
		tail -n 20 "$server_log" >&2
		exit 2
	fi
	sleep 1
done

# 待ち受けのポートのプロセス（BEAM）。見つからなければ、メモリと CPU は測らない。
beam_pid="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [ -n "$beam_pid" ]; then
	echo "[load] サーバーのプロセス: ${beam_pid}"
else
	echo "[load] サーバーのプロセスが見つかりません（メモリと CPU は測りません）"
fi

set +e
(cd "$repo_root" && RONDO_BOTS_URL="ws://localhost:${port}/ws" RONDO_SERVER_PID="$beam_pid" \
	pnpm --silent --filter @rondo/bots exec node "src/trials/${kind}.ts" "$@")
status=$?
set -e

# サーバーがまだ生きているか（落ちていれば、試験の結果に関わらず失敗にする）。
if ! curl -s -o /dev/null "http://localhost:${port}/"; then
	echo "[load] 失敗: 試験の後、サーバーが応答しません" >&2
	status=1
fi
sleep 1
for pattern in "受信プロセスが落ち" "CRASH REPORT" "ERROR REPORT" "include_shared_binaries を使えません"; do
	count="$(grep -c "$pattern" "$server_log" || true)"
	echo "[load] サーバーのログの『${pattern}』: ${count} 行"
done
echo "[load] サーバーのログの末尾:"
tail -n 10 "$server_log"
exit "$status"
