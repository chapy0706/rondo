#!/usr/bin/env bash
# 載せ換えの前の最終確認（make preflight）。次を順に流し、1 つでも失敗したら、そこで止まる。
#
#   1. make verify                              Biome・型・テスト（TS と Gleam）。サーバーもブラウザも使わない
#   2. make bots                                ボットの対戦。tools/bots.sh が 3300 番でサーバーを起動し、終わったら止める
#   3. ./tools/load.sh limits                   上限の試験。3300 番でサーバーを起動し、終わったら止める
#   4. ./tools/load.sh join                     参加・復帰の組み合わせ表。同じく 3300 番で起動・停止
#   5. make e2e                                 2 タブの E2E。Playwright がサーバー（3000）と web（3100）を起動し、終わったら止める
#   6. pnpm --filter @rondo/e2e e2e:extended    拡張の E2E。Playwright がサーバー（3000）と web（3102）を起動し、終わったら止める
#
# 前提（この台本は起動しない）:
# - make dev-all を止めておく（3000・3100 番を使うため。e2e は動いているサーバーを使い回せるが、拡張の E2E
#   は同じフォルダで next dev を 2 つ動かせないので、どれも空いている状態から始める）
# - Playwright のブラウザを取得してある（初回だけ。ネットワークを使う）:
#     pnpm --filter @rondo/e2e exec playwright install chromium webkit
#
# 最後に、通った一覧とかかった時間、いまのコミット、未コミットの変更の有無（警告だけ）を出す。

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 2

# 使うポート。どれかが使われていれば、始めずに止める（途中でぶつからないように）。
ports=(3000 3100 3102 3300)
busy=()
for port in "${ports[@]}"; do
	if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
		busy+=("$port")
	fi
done
if [ "${#busy[@]}" -gt 0 ]; then
	echo "[preflight] 使われているポートがあります: ${busy[*]}" >&2
	echo "[preflight] make dev-all などを止めてから、もう一度実行してください（3000・3100・3102・3300 番を使います）" >&2
	exit 2
fi

steps=(
	"make verify"
	"make bots"
	"./tools/load.sh limits"
	"./tools/load.sh join"
	"make e2e"
	"pnpm --filter @rondo/e2e e2e:extended"
)

passed=()
durations=()
started_all=$(date +%s)

for step in "${steps[@]}"; do
	echo ""
	echo "[preflight] ===== ${step} ====="
	started=$(date +%s)
	if ! bash -c "$step"; then
		elapsed=$(($(date +%s) - started))
		echo "" >&2
		echo "[preflight] 失敗: ${step}（${elapsed} 秒）" >&2
		if [ "${#passed[@]}" -gt 0 ]; then
			echo "[preflight] それまでに通ったもの: ${passed[*]}" >&2
		fi
		exit 1
	fi
	passed+=("$step")
	durations+=($(($(date +%s) - started)))
done

total=$(($(date +%s) - started_all))
echo ""
echo "[preflight] すべて通りました"
for i in "${!passed[@]}"; do
	printf "  通過  %-42s %4d 秒\n" "${passed[$i]}" "${durations[$i]}"
done
printf "  合計  %-42s %4d 秒\n" "" "$total"

echo ""
echo "[preflight] いまのコミット: $(git rev-parse --short HEAD)"
changes="$(git status --short)"
if [ -n "$changes" ]; then
	echo "[preflight] 警告: 未コミットの変更があります（載せ換えるのは、コミットした内容です）"
	echo "$changes"
else
	echo "[preflight] 未コミットの変更はありません"
fi
