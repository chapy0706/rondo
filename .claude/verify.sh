#!/usr/bin/env bash
# .claude/verify.sh
#
# プロジェクト固有の検証スクリプト。
# .claude/hooks/run-verify.sh（Stop hook）から呼ばれる。
#
# 役割:
#   コードを変更したあと、意図通りか・壊れていないかを確認する。
#   format / lint / type-check / test をここに並べる。
#   フロント（TypeScript）と リアルタイム基盤（Gleam）の両方を見る。
#
# 方針:
#   - 速い検証（biome ci, type-check）から並べ、重い test を後に置く
#   - biome ci は format 検査と lint を兼ねる
#   - Gleam 側は format 検査・型検査・test を順に通す
#   - 失敗したら非ゼロで終了する。run-verify.sh がそれを Claude に返す
#
# 注意:
#   このファイルは検証の強度そのもの。Claude Code から編集できないよう
#   .claude/settings.json の deny で Edit/Write を禁止すること。

set -euo pipefail

# --- フロントエンド（TypeScript / pnpm workspaces） ---

echo "[verify] biome (format + lint)"
pnpm biome ci .

echo "[verify] type-check"
pnpm -r type-check

echo "[verify] test (web)"
pnpm -r test

# --- リアルタイム基盤（Gleam / OTP） ---

echo "[verify] gleam format --check"
( cd server && gleam format --check )

echo "[verify] gleam check"
( cd server && gleam check )

echo "[verify] gleam test"
( cd server && gleam test )

echo "[verify] passed."
