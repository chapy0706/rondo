#!/usr/bin/env bash
# rondo を A1 で docker compose を使って更新する（issue-35 / issue-43。docs/deploy.md）。
#
# 使い方（A1 の、リポジトリの作業コピーで）:
#   deploy/a1-deploy.sh --env-file <リポジトリの外のファイル> [--verify] <web|ws|assets|all>
#
#   対象は、引数か環境変数 RONDO_DEPLOY_TARGET で選ぶ（引数が優先）。
#   env ファイルは、引数 --env-file か環境変数 RONDO_ENV_FILE で渡す（引数が優先）。
#
# env ファイル（リポジトリの外に置く。コミットしない）の例:
#   NEXT_PUBLIC_RONDO_WS_URL=wss://ws-rondo.chapy0706.com/ws
#   NEXT_PUBLIC_ASSET_BASE_URL=https://assets-rondo.chapy0706.com
#   ASSET_ALLOWED_ORIGIN=https://rondo.chapy0706.com
#   RONDO_VERIFY_WEB_URL=https://rondo.chapy0706.com   （--verify のときに確かめる web の URL）
#
# - web（と all）では、NEXT_PUBLIC_RONDO_WS_URL と NEXT_PUBLIC_ASSET_BASE_URL の2つを、必ず
#   env ファイルからそろえて渡す。どちらかの行が無い、または値が空なら、止まって警告する
#   （NEXT_PUBLIC_* はビルド時に埋め込まれるので、片方を忘れると、その機能が黙って止まるため）。
#   わざと空にする（モック動作にする、素材を読み込まない）ときだけ、--allow-empty を付ける
# - 実行すること: prod ブランチであることの確認、git pull（早送りのみ）、docker compose build、
#   docker compose up -d、コンテナが動いていることの確認
# - コンテナやボリュームを消す操作はしない
# - --verify を付けると、最後にデプロイ後の確認（issue-50）を行う。A1 の中の確認
#   （tools/verify-a1.sh）と、公開 URL に対する外からの確認（tools/verify.sh。URL は env ファイルから）。
#   失敗したら、見方と戻し方（docs/deploy.md「デプロイ後の確認」）を表示し、0 以外で終わる

set -euo pipefail

usage() {
	cat <<'EOF'
使い方: deploy/a1-deploy.sh [--env-file <ファイル>] [--allow-empty] [--verify] <web|ws|assets|all>
  対象は引数か RONDO_DEPLOY_TARGET、env ファイルは --env-file か RONDO_ENV_FILE で渡す。
  --verify: 最後にデプロイ後の確認を行う（env ファイルが要る）。
EOF
}

die() {
	echo "停止: $*" >&2
	exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${RONDO_DEPLOY_TARGET:-}"
env_file="${RONDO_ENV_FILE:-}"
allow_empty=0
verify=0

while [ "$#" -gt 0 ]; do
	case "$1" in
	--env-file)
		[ "$#" -ge 2 ] || die "--env-file の後にファイルを書く"
		env_file="$2"
		shift 2
		;;
	--allow-empty)
		allow_empty=1
		shift
		;;
	--verify)
		verify=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	web | ws | assets | all)
		target="$1"
		shift
		;;
	*)
		usage >&2
		die "知らない引数: $1"
		;;
	esac
done

case "$target" in
web | ws | assets | all) ;;
"")
	usage >&2
	die "対象（web / ws / assets / all）を選ぶ"
	;;
*) die "知らない対象: $target" ;;
esac

# 対象ごとの compose ファイルとコンテナ名。
compose_file() {
	case "$1" in
	web) echo "docker-compose.web.prod.yml" ;;
	ws) echo "docker-compose.server.prod.yml" ;;
	assets) echo "docker-compose.assets.prod.yml" ;;
	esac
}

container_name() {
	case "$1" in
	web) echo "rondo-app" ;;
	ws) echo "rondo-ws" ;;
	assets) echo "rondo-assets" ;;
	esac
}

if [ "$target" = "all" ]; then
	targets=(ws assets web)
else
	targets=("$target")
fi

needs_web_vars=0
for t in "${targets[@]}"; do
	if [ "$t" = "web" ]; then
		needs_web_vars=1
	fi
done

# env ファイルの確認。web をビルドするときは必須。値はファイルから読むだけで、実行（source）しない。
compose_env_args=()
if [ -n "$env_file" ]; then
	[ -f "$env_file" ] || die "env ファイルが無い: $env_file"
	env_abs="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
	case "$env_abs" in
	"$repo_root"/*) die "env ファイルはリポジトリの外に置く（コミットしないため）: $env_abs" ;;
	esac
	compose_env_args=(--env-file "$env_abs")
elif [ "$needs_web_vars" -eq 1 ]; then
	die "web をビルドするときは --env-file（または RONDO_ENV_FILE）が要る"
elif [ "$verify" -eq 1 ]; then
	die "--verify には --env-file（または RONDO_ENV_FILE）が要る（確認の URL を読むため）"
fi

# env ファイルの、ある変数の値（無ければ終了コード 1）。前後の引用符は外す。
read_var() {
	local name="$1" line value
	line="$(grep -E "^${name}=" "$env_abs" | tail -n 1)" || return 1
	value="${line#*=}"
	value="${value%\"}"
	value="${value#\"}"
	value="${value%\'}"
	value="${value#\'}"
	printf '%s' "$value"
}

if [ "$needs_web_vars" -eq 1 ]; then
	for name in NEXT_PUBLIC_RONDO_WS_URL NEXT_PUBLIC_ASSET_BASE_URL; do
		if ! value="$(read_var "$name")"; then
			die "env ファイルに ${name}= の行が無い（2つの NEXT_PUBLIC_* は必ずそろえて書く）"
		fi
		if [ -z "$value" ] && [ "$allow_empty" -ne 1 ]; then
			echo "警告: ${name} が空。空のままビルドすると、その機能が止まる" >&2
			die "わざと空にするときだけ --allow-empty を付けて実行し直す"
		fi
		echo "${name}=${value:-（空）}"
	done
fi

# シェルに残っている同名の変数は、env ファイルより優先されてしまうので、ここで外す。
unset NEXT_PUBLIC_RONDO_WS_URL NEXT_PUBLIC_ASSET_BASE_URL ASSET_ALLOWED_ORIGIN ASSET_HOST_DIR

cd "$repo_root"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "prod" ] || die "prod ブランチで実行する（いまは ${branch}）。git switch prod の後に実行し直す"

echo "== git pull（早送りのみ）"
git pull --ff-only

for t in "${targets[@]}"; do
	file="$(compose_file "$t")"
	name="$(container_name "$t")"
	echo "== ${t}: ${file} をビルド"
	docker compose ${compose_env_args[@]+"${compose_env_args[@]}"} -f "$file" build
	echo "== ${t}: 起動（変わったコンテナだけ作り直される）"
	docker compose ${compose_env_args[@]+"${compose_env_args[@]}"} -f "$file" up -d
	echo "== ${t}: ${name} の確認"
	sleep 2
	running="$(docker ps --filter "name=^${name}$" --filter "status=running" --format '{{.Names}}')"
	if [ "$running" != "$name" ]; then
		echo "ログ: docker logs --tail 100 ${name}" >&2
		die "${name} が動いていない"
	fi
	echo "${name} は動いている"
done

echo "完了: ${targets[*]}"

if [ "$verify" -eq 0 ]; then
	exit 0
fi

# デプロイ後の確認（issue-50）。2つとも行ってから判定する（片方が失敗しても、もう片方を見る）。
echo "== デプロイ後の確認"
inside=0
"$repo_root/tools/verify-a1.sh" || inside=$?
outside=0
"$repo_root/tools/verify.sh" --env-file "$env_abs" || outside=$?

if [ "$inside" -eq 0 ] && [ "$outside" -eq 0 ]; then
	echo "デプロイ後の確認: 成功"
	exit 0
fi

if [ "$outside" -eq 2 ]; then
	echo "外からの確認を実行できなかった（理由は上の行）。手元から tools/verify.sh --web <URL> --ws <URL> [--assets <URL>] で確かめる" >&2
fi
if [ "$inside" -ne 0 ] || [ "$outside" -eq 1 ]; then
	cat >&2 <<'EOF'
デプロイ後の確認: 失敗（上の [FAIL] の行が、失敗した項目）
見方と戻し方: docs/deploy.md の「デプロイ後の確認」
  - 起動直後の一時的な失敗か: 少し待ってから tools/verify-a1.sh と tools/verify.sh --env-file <env> を実行し直す
  - 戻す: 手元で、問題のコミットを prod 上で git revert して push し、A1 で同じ deploy/a1-deploy.sh を実行し直す
EOF
fi
exit 1
