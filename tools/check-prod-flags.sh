#!/usr/bin/env bash
# 本番に出してはいけない旗の確認（issue-67）。本番のビルドと起動に使うファイルに、開発・E2E 用の旗が
# 無いことを確かめる。make preflight の最初と、docs/deploy.md のデプロイの前の確認で使う。
#
#   ./tools/check-prod-flags.sh                         # リポジトリの中のファイルだけ
#   ./tools/check-prod-flags.sh --env-file ~/rondo.env  # A1 の env ファイル（リポジトリの外）も
#
# 確かめる旗:
# - NEXT_PUBLIC_RONDO_SPECTATE_DEV（web のビルド変数。1 だと、来場者の画面でも観戦の行を押せる）
# - NEXT_PUBLIC_VERYARE_ROAMING・NEXT_PUBLIC_VERYARE_SPREADING（web のビルド変数。1 だと、来場者のロビーにも
#   新しい規則の選択肢が出る。本番で出すときは、旗（manifest.ts の ROAMING_READY・SPREADING_READY）か、URL の
#   ?rules=1 を使う / ADR 0053）
#
# 確かめるファイル: deploy/ の下、apps/web/Dockerfile、本番の compose のファイル（docker-compose.*.prod.yml）。
# 見つけたら、ファイルと行の番号だけを出す（値は出さない）。
# サーバーの RONDO_SPECTATE_DEV は、発表会の当日に A1 の env ファイルへ足す運用なので、ここでは確かめない
# （docs/runbook.md）。
#
# 終了コード: 見つからなければ 0、見つかれば 1、使い方の誤り・ファイルが無いときは 2。

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

flags=(NEXT_PUBLIC_RONDO_SPECTATE_DEV NEXT_PUBLIC_VERYARE_ROAMING NEXT_PUBLIC_VERYARE_SPREADING)

env_file=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--env-file)
			env_file="${2:-}"
			shift 2 || true
			;;
		*)
			echo "使い方: ./tools/check-prod-flags.sh [--env-file <path>]" >&2
			exit 2
			;;
	esac
done

targets=(deploy apps/web/Dockerfile)
for file in docker-compose.*.prod.yml; do
	[ -e "$file" ] && targets+=("$file")
done
if [ -n "$env_file" ]; then
	if [ ! -f "$env_file" ]; then
		echo "[check-prod-flags] env ファイルが見つかりません: ${env_file}" >&2
		exit 2
	fi
	targets+=("$env_file")
fi

found=0
for flag in "${flags[@]}"; do
	# 行の中身（値）は出さず、ファイルと行の番号だけを出す。
	if matches="$(grep -rn --exclude-dir=node_modules -- "$flag" "${targets[@]}" 2>/dev/null | cut -d: -f1,2)"; then
		if [ -n "$matches" ]; then
			found=1
			echo "[check-prod-flags] 本番に出してはいけない旗 ${flag} があります:" >&2
			while IFS= read -r line; do
				echo "  ${line}" >&2
			done <<<"$matches"
		fi
	fi
done

if [ "$found" -ne 0 ]; then
	exit 1
fi
echo "[check-prod-flags] 本番に出してはいけない旗はありません（${targets[*]}）"
