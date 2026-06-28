#!/usr/bin/env bash
# .claude/hooks/protect-secrets.sh
# 目的: 機密ファイルの Read をブロック（安全側）

set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 が見つからないため安全側に deny"}}
JSON
  exit 0
fi

INPUT="$(cat)"

FILE_PATH="$(python3 - <<'PY'
import json,sys
try:
  obj=json.loads(sys.stdin.read())
  print(obj.get("tool_input",{}).get("file_path","") or "")
except Exception:
  print("")
PY
<<<"$INPUT")"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PATTERNS=(
  "\.env$"
  "\.env\."
  "/secrets/"
  "\.pem$"
  "\.key$"
  "id_rsa"
  "credentials"
  "token"
)

for p in "${PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -qE "$p"; then
    python3 - <<PY
import json
fp=${FILE_PATH!r}
pt=${p!r}
print(json.dumps({
  "hookSpecificOutput":{
    "hookEventName":"PreToolUse",
    "permissionDecision":"deny",
    "permissionDecisionReason":f"機密ファイルへのアクセスがブロックされました: {fp} (matched {pt})"
  }
}))
PY
    exit 0
  fi
done

exit 0
