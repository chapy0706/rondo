#!/usr/bin/env bash
# .claude/hooks/run-verify.sh
# 目的: Claude が応答を終える直前（Stop）に検証を走らせ、
#       結果を Claude に返して自己修正を促す。
#
# 仕組み:
#   - プロジェクトルートの .claude/verify.sh を探して実行する
#   - verify.sh がなければ何もしない（検証なしのプロジェクトを許容）
#   - 検証が失敗したら、その出力を理由として Claude に返す
#
# このスクリプト自体は「トリガー」に徹する。
# 何を検証するか（lint / type-check / build など）は verify.sh 側が持つ。

set -euo pipefail

# Claude Code はプロジェクトルートで hook を実行する
readonly VERIFY_SCRIPT=".claude/verify.sh"

# verify.sh がなければ、検証なしとして静かに通す
if [ ! -f "${VERIFY_SCRIPT}" ]; then
	exit 0
fi

# 検証を実行し、出力と終了コードを捕捉する
set +e
VERIFY_OUTPUT="$(bash "${VERIFY_SCRIPT}" 2>&1)"
VERIFY_EXIT=$?
set -e

if [ "${VERIFY_EXIT}" -eq 0 ]; then
	# 検証成功。何も言わず通す
	exit 0
fi

# 検証失敗。Stop hook の reason として Claude に返す。
# decision: block で Claude のターンを継続させ、自己修正させる。
if command -v python3 >/dev/null 2>&1; then
	python3 - <<PY
import json
output = """${VERIFY_OUTPUT}"""
reason = (
    "検証 (.claude/verify.sh) が失敗しました。"
    "コードの修正後、検証が通る状態にしてからターンを終えてください。\n\n"
    "--- verify 出力 ---\n" + output
)
print(json.dumps({"decision": "block", "reason": reason}))
PY
else
	# python3 がない環境向けのフォールバック
	printf '{"decision":"block","reason":"検証に失敗しました。.claude/verify.sh の出力を確認し修正してください。"}\n'
fi

exit 0
