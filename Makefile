SHELL := /bin/bash

.PHONY: help
help:
	@echo ""
	@echo "rondo Makefile"
	@echo ""
	@echo "  setup          初期セットアップ（pnpm install + gleam deps）"
	@echo "  dev            開発サーバー起動（フロント + モックWS・ホットリロード）"
	@echo "  dev/web        Next.js 開発サーバーのみ起動"
	@echo "  dev/server     Gleam WebSocket サーバーのみ起動"
	@echo ""
	@echo "  test           フロントのテスト（Vitest）"
	@echo "  test/server    Gleam サーバーのテスト（gleam test）"
	@echo ""
	@echo "  lint           静的解析（Biome）"
	@echo "  type-check     型チェック（tsc）"
	@echo "  fmt            フォーマット適用（Biome + gleam format）"
	@echo "  fmt/check      フォーマット検査（差分があれば失敗）"
	@echo ""
	@echo "  verify         全チェック（Biome + 型 + test、TS/Gleam 両方）"
	@echo "  check          verify のエイリアス"
	@echo "  evidence       verify + ログ出力（tmp/evidence/）"
	@echo ""
	@echo "  issue/list     docs/issues 配下の未完了 Issue を表示"
	@echo "  issue/new      Issue テンプレートを作成"
	@echo ""
	@echo "  clean          node_modules / ビルド成果物の削除"
	@echo ""

# ------------------------
# Setup
# ------------------------

.PHONY: setup
setup:
	pnpm install
	cd server && gleam deps download

# ------------------------
# Dev
# ------------------------

.PHONY: dev
dev:
	pnpm dev

.PHONY: dev/web
dev/web:
	pnpm --filter @rondo/web dev

.PHONY: dev/server
dev/server:
	cd server && gleam run

# ------------------------
# Test
# ------------------------

.PHONY: test
test:
	pnpm -r test

.PHONY: test/server
test/server:
	cd server && gleam test

# ------------------------
# Lint / Format / Types
# ------------------------

.PHONY: lint
lint:
	pnpm biome lint .

.PHONY: type-check
type-check:
	pnpm -r type-check

.PHONY: fmt
fmt:
	pnpm biome format --write .
	cd server && gleam format

.PHONY: fmt/check
fmt/check:
	pnpm biome format .
	cd server && gleam format --check

# ------------------------
# Verify
# ------------------------

.PHONY: verify
verify:
	pnpm biome ci .
	pnpm -r type-check
	pnpm -r test
	cd server && gleam format --check && gleam check && gleam test
	@echo ""
	@echo "[verify] passed."

.PHONY: check
check: verify

.PHONY: evidence
evidence:
	@mkdir -p tmp/evidence
	pnpm biome ci . 2>&1 | tee tmp/evidence/biome.log
	pnpm -r type-check 2>&1 | tee tmp/evidence/type-check.log
	pnpm -r test 2>&1 | tee tmp/evidence/test.log
	( cd server && gleam format --check ) 2>&1 | tee tmp/evidence/gleam-fmt.log
	( cd server && gleam check ) 2>&1 | tee tmp/evidence/gleam-check.log
	( cd server && gleam test ) 2>&1 | tee tmp/evidence/gleam-test.log
	@echo ""
	@echo "evidence saved to tmp/evidence/"

# ------------------------
# Issue 管理
# ------------------------

.PHONY: issue/list
issue/list:
	@echo ""
	@echo "未完了 Issue 一覧 (docs/issues/):"
	@echo ""
	@if ls docs/issues/*.md >/dev/null 2>&1; then \
		grep -l "status: open" docs/issues/*.md 2>/dev/null \
			| xargs -I{} sh -c 'echo "  $$(basename {}): $$(grep "^# " {} | head -1 | sed "s/^# //")"' \
			|| echo "  （未完了の Issue はありません）"; \
	else \
		echo "  （docs/issues/ に Issue ファイルがありません）"; \
	fi
	@echo ""

.PHONY: issue/new
issue/new:
	@if [ -z "$(name)" ]; then echo "使い方: make issue/new name=issue-XX-issue-name" && exit 1; fi
	@if [ -f "docs/issues/$(name).md" ]; then echo "すでに存在します: docs/issues/$(name).md" && exit 1; fi
	cp docs/issues/_template.md docs/issues/$(name).md
	@echo "作成しました: docs/issues/$(name).md"

# ------------------------
# Clean
# ------------------------

.PHONY: clean
clean:
	find . -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name .next -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name dist -type d -prune -exec rm -rf {} + 2>/dev/null || true
	cd server && rm -rf build
