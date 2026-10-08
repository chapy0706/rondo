/**
 * 2タブの E2E スモーク（issue-48）。
 *
 * - make e2e: シナリオ1〜4（@result の付いていないもの）
 * - make e2e/result: シナリオ5（鬼選出から結果画面まで。約2分）
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
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 15_000 },
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
