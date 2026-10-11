#!/usr/bin/env bash
# A1 の中で、デプロイ後の状態を確かめる（issue-50）。利用者に影響しない、読み取りだけの確認。
# deploy/a1-deploy.sh --verify からも呼ばれる。
#
#   tools/verify-a1.sh
#
# 確かめること:
#   - コンテナ（rondo-app / rondo-ws）が起動している。rondo-assets は、あれば起動している
#   - 直近のログに、エラーが連続して出ていない（エラーらしき行の件数を、しきい値で判定）
#   - rondo-ws の起動ログに、「include_shared_binaries を使えません」（OTP が古く、ソケット1本
#     ごとのメモリ上限が実質効かない警告 / issue-51）が出ていない
#
# 設定（環境変数）:
#   RONDO_VERIFY_LOG_LINES       直近に見るログの行数（既定 200）
#   RONDO_VERIFY_ERROR_THRESHOLD エラーらしき行がこの数以上で失敗（既定 5）
#
# 秘密の値は出さない（ログの中身はそのまま出さず、件数と、サーバーが出す既知の警告の行だけ出す）。
# 終了コード: 全項目が通れば 0、1つでも失敗すれば 1。

set -euo pipefail

log_lines="${RONDO_VERIFY_LOG_LINES:-200}"
error_threshold="${RONDO_VERIFY_ERROR_THRESHOLD:-5}"
heap_warning='include_shared_binaries を使えません'

pass=0
fail=0

ok() {
	echo "  [OK  ] $1"
	pass=$((pass + 1))
}

ng() {
	echo "  [FAIL] $1"
	fail=$((fail + 1))
}

skip() {
	echo "  [SKIP] $1"
}

# コンテナがあるか（止まっていても、あれば真）。
exists() {
	[ "$(docker ps -a --filter "name=^${1}$" --format '{{.Names}}')" = "$1" ]
}

# コンテナが起動しているか。
check_running() {
	local name="$1" running
	running="$(docker ps --filter "name=^${name}$" --filter "status=running" --format '{{.Names}}')"
	if [ "$running" = "$name" ]; then
		ok "${name} は起動している"
	else
		ng "${name} が起動していない（docker ps -a --filter name=${name} と docker logs --tail 100 ${name} で確かめる）"
	fi
}

# 直近のログに、エラーが連続していないか。件数だけを見る（中身は出さない）。
check_logs() {
	local name="$1" logs count
	if ! exists "$name"; then
		ng "${name} のログを読めない（コンテナが無い）"
		return
	fi
	# パイプの途中で止まる（SIGPIPE）と pipefail で誤判定するので、先に変数へ取る。
	logs="$(docker logs --tail "$log_lines" "$name" 2>&1)" || {
		ng "${name} のログを読めない（docker logs が失敗）"
		return
	}
	count="$(printf '%s\n' "$logs" | grep -c -iE 'error|crash report|panic|exception' || true)"
	if [ "$count" -ge "$error_threshold" ]; then
		ng "${name} の直近 ${log_lines} 行に、エラーらしき行が ${count} 件（しきい値 ${error_threshold}）。docker logs --tail ${log_lines} ${name} で確かめる"
	else
		ok "${name} の直近 ${log_lines} 行のエラーらしき行は ${count} 件（しきい値 ${error_threshold} 未満）"
	fi
}

# rondo-ws の起動ログに、メモリ上限が実質効かない警告（issue-51）が出ていないか。
# 起動時に1回だけ出るので、--tail を付けず、コンテナの起動からのログ全体を見る。
check_heap_warning() {
	local logs line
	if ! exists rondo-ws; then
		ng "rondo-ws の起動ログを読めない（コンテナが無い）"
		return
	fi
	logs="$(docker logs rondo-ws 2>&1)" || {
		ng "rondo-ws の起動ログを読めない（docker logs が失敗）"
		return
	}
	line="$(printf '%s\n' "$logs" | grep -m1 -F "$heap_warning" || true)"
	if [ -n "$line" ]; then
		ng "rondo-ws: 起動ログに「${heap_warning}」が出ている（OTP が古く、ソケット1本ごとのメモリ上限が実質効かない）: ${line}"
	else
		ok "rondo-ws: 起動ログに「${heap_warning}」は出ていない"
	fi
}

echo "A1 の中の確認 $(date '+%Y-%m-%dT%H:%M:%S%z')"

if ! command -v docker >/dev/null 2>&1; then
	echo "  [FAIL] docker が見つからない（A1 の中で実行する）"
	exit 1
fi

check_running rondo-app
check_running rondo-ws
check_logs rondo-app
check_logs rondo-ws
check_heap_warning

# 素材のコンテナは、あるときだけ確かめる（素材の配信を設定していない環境では省く）。
if exists rondo-assets; then
	check_running rondo-assets
	check_logs rondo-assets
else
	skip "rondo-assets は無い（素材の配信を設定していない環境として省いた）"
fi

echo "A1 の中の確認: 成功 ${pass} / 失敗 ${fail}"
[ "$fail" -eq 0 ]
