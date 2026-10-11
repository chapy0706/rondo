#!/usr/bin/env bash
# デプロイ後の確認のうち、外から（公開 URL に対して）確かめる部分（issue-50）。
# 手元の Mac からも、A1 からも実行できる。deploy/a1-deploy.sh --verify からも呼ばれる。
#
#   tools/verify.sh --env-file ~/rondo.env
#   tools/verify.sh --web https://rondo.chapy0706.com --ws wss://ws-rondo.chapy0706.com/ws \
#                   --assets https://assets-rondo.chapy0706.com
#   tools/verify.sh --env-file ~/rondo.env --ping-timeout-ms 5000 --retries 1
#
# 引数は、そのまま bots/src/verify.ts へ渡す（引数の意味と、URL の受け取り方は、そちらの冒頭）。
# - 確かめること: web の応答、WebSocket の接続と session、ルームの作成と退出、ping、素材の配信
# - 利用者に影響しない操作だけを行う。作ったルームは必ず退出する
# - env ファイルからは、URL の行だけを読む。秘密の値は出さない
# - node の依存（node_modules）は使わない。Node 22.18 以降（TypeScript をそのまま実行できる版）が要る
# - 終了コード: 全項目が通れば 0、失敗があれば 1、実行できない（node が無い・使い方の誤り）ときは 2

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
	echo "[verify] node が見つかりません。Node 22.18 以降を入れるか、手元（Mac）から実行してください" >&2
	exit 2
fi

# TypeScript をそのまま実行できるか（process.features.typescript）と、WebSocket が組み込みか。
if ! node -e 'process.exit(process.features.typescript && typeof WebSocket === "function" ? 0 : 1)' 2>/dev/null; then
	echo "[verify] この node（$(node --version)）では実行できません。Node 22.18 以降が要ります" >&2
	exit 2
fi

# --env-file は、node へは --urls-from として渡す（node 自身がスクリプトの後ろの --env-file も
# 拾い、ファイルの全部の値を環境変数に読み込んでしまうため）。ほかの引数は、そのまま渡す。
node_args=()
while [ "$#" -gt 0 ]; do
	case "$1" in
	--env-file)
		[ "$#" -ge 2 ] || {
			echo "[verify] --env-file の後にファイルを書く" >&2
			exit 2
		}
		node_args+=(--urls-from "$2")
		shift 2
		;;
	*)
		node_args+=("$1")
		shift
		;;
	esac
done

# 型を外して実行する機能の、実験的機能の警告は出さない（確認の結果を読みやすくするため）。
exec node --disable-warning=ExperimentalWarning "$repo_root/bots/src/verify.ts" ${node_args[@]+"${node_args[@]}"}
