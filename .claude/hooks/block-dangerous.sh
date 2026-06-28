#!/usr/bin/env bash
# .claude/hooks/block-dangerous.sh
# 目的: 危険な Bash 実行をブロック（安全側）

set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 が見つからないため安全側に deny"}}
JSON
  exit 0
fi

INPUT="$(cat)"

CMD="$(python3 - <<'PY'
import json,sys
try:
  obj=json.loads(sys.stdin.read())
  print(obj.get("tool_input",{}).get("command","") or "")
except Exception:
  print("")
PY
<<<"$INPUT")"

if [ -z "$CMD" ]; then
  exit 0
fi

PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf *"
  "git reset --hard"
  "git push --force"
  "git push -f"
  "mkfs."
  "dd if=/dev/zero"
  ":(){ :|:& };:"
)

for p in "${PATTERNS[@]}"; do
  if echo "$CMD" | grep -qE "$p"; then
    python3 - <<PY
import json
print(json.dumps({
  "hookSpecificOutput":{
    "hookEventName":"PreToolUse",
    "permissionDecision":"deny",
    "permissionDecisionReason":f"危険なコマンドがブロックされました: {p}"
  }
}))
PY
    exit 0
  fi
done

exit 0
