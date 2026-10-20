/**
 * 終わったルームの自動閉鎖の E2E（@expiry / issue-70）。make e2e には入れない（サーバーを、時間を縮めて
 * 別のポートで起動するため）。
 *
 *   pnpm --filter @rondo/e2e e2e:expiry
 *
 * 起動するもの（どちらも、動いているものは使わず、ここで起動して、終わったら止める）:
 * - サーバー（3004）。フェーズ時間と、結果のあとに閉じるまでの時間（3 分）を 1/20 に縮める
 *   （RONDO_TEST_PHASE_DIVISOR=20。閉じるまで 9 秒）
 * - web（3104）。3004 のサーバーにつなぐ。make dev-all の web（3100）とは別に起動する（同じフォルダで
 *   next dev を 2 つ動かさないよう、make dev-all は止めておく）
 */

import { defineConfig, devices } from "@playwright/test";
import { WAIT_MS } from "./timeouts";

const SERVER_PORT = 3004;
const WEB_PORT = 3104;

export default defineConfig({
	testDir: "./tests",
	testMatch: "expiry.e2e.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: WAIT_MS },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		actionTimeout: WAIT_MS,
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
	},
	webServer: [
		{
			command: "gleam run",
			cwd: "../server",
			url: `http://localhost:${SERVER_PORT}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: { RONDO_PORT: String(SERVER_PORT), RONDO_TEST_PHASE_DIVISOR: "20" },
		},
		{
			command: `pnpm --filter @rondo/web exec next dev --port ${WEB_PORT}`,
			cwd: "..",
			url: `http://localhost:${WEB_PORT}/`,
			reuseExistingServer: false,
			timeout: 180_000,
			env: { NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SERVER_PORT}/ws` },
		},
	],
});
