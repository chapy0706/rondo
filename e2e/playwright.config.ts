/**
 * 2タブの E2E スモーク（issue-48）。
 *
 * - make e2e: シナリオ1〜4（@result の付いていないもの）と、テスト用の口が無いことの確認（issue-52）
 * - make e2e/result: シナリオ5（鬼選出から結果画面まで。約2分。結果画面の見た目の比較を含む）
 *
 * スマホの端末設定・WebKit・素材の失敗・テスト用の口の E2E は、playwright.extended.config.ts（issue-52）。
 *
 * サーバーと web は、`make dev-all` と同じポートで起動する。すでに `make dev-all` が
 * 動いていれば、それを使う（reuseExistingServer）。web は実接続（Gleam サーバー）で動く。
 * 同じサーバーのルームを使い回すので、テストは1本ずつ順に動かす（workers: 1）。
 */

import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 3000;
const WEB_PORT = 3100;

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.e2e.ts",
	// 拡張の E2E（テスト用の口と、素材の差し替えが要る）は、playwright.extended.config.ts で流す。
	testIgnore: "extended/**",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: {
		timeout: 15_000,
		// 見た目の比較（issue-52）: 画素の 1% までの差は許す。アニメーションは止めて撮る。
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.01,
			animations: "disabled",
			stylePath: "./tests/screenshot.css",
		},
	},
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: [
		{
			command: "gleam run",
			cwd: "../server",
			url: `http://localhost:${SERVER_PORT}/`,
			reuseExistingServer: true,
			timeout: 120_000,
		},
		{
			command: `pnpm --filter @rondo/web exec next dev --port ${WEB_PORT}`,
			cwd: "..",
			url: `http://localhost:${WEB_PORT}/`,
			reuseExistingServer: true,
			timeout: 180_000,
			env: { NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SERVER_PORT}/ws` },
		},
	],
});
