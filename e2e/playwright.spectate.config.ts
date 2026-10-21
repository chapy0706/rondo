/**
 * 観戦ルームの E2E（@spectate / issue-67）。make e2e には入れない（観戦ルームを受け付けるサーバーと web を、
 * 別のポートで起動するため）。
 *
 *   pnpm --filter @rondo/e2e e2e:spectate
 *
 * 起動するもの（どちらも、動いているものは使わず、ここで起動して、終わったら止める）:
 * - サーバー（3005）。開発用の RONDO_SPECTATE_DEV=1 で、観戦ルームを受け付ける。フェーズ時間と、観戦
 *   ルームの時間（結果を見せる 10 秒・0 人で閉じる 60 秒）を 1/4 に縮める（RONDO_TEST_PHASE_DIVISOR=4）
 * - web（3105）。3005 のサーバーにつなぐ。開発用の NEXT_PUBLIC_RONDO_SPECTATE_DEV=1 で、ロビーの観戦
 *   ルームの行を押せる。make dev-all の web（3100）とは別に起動する（make dev-all は止めておく）
 *
 * 観戦の流れは Chrome で、iPhone の縦画面の収まり（@layout）は WebKit で測る（layout-fit.e2e.ts と
 * 同じ測り方 / layout.ts。初回だけ `pnpm --filter @rondo/e2e exec playwright install webkit` が要る）。
 */

import { defineConfig, devices } from "@playwright/test";
import { WAIT_MS } from "./timeouts";

/** tests/spectate.e2e.ts のボットも、このポートへつなぐ。 */
const SPECTATE_SERVER_PORT = 3005;
const WEB_PORT = 3105;

export default defineConfig({
	testDir: "./tests",
	testMatch: "spectate.e2e.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	expect: { timeout: WAIT_MS },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		actionTimeout: WAIT_MS,
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chrome",
			use: { ...devices["Desktop Chrome"] },
			grepInvert: /@layout/,
		},
		{
			name: "iphone-webkit",
			use: { ...devices["iPhone 13"] },
			grep: /@layout/,
		},
	],
	webServer: [
		{
			command: "gleam run",
			cwd: "../server",
			url: `http://localhost:${SPECTATE_SERVER_PORT}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				RONDO_PORT: String(SPECTATE_SERVER_PORT),
				RONDO_SPECTATE_DEV: "1",
				RONDO_TEST_PHASE_DIVISOR: "4",
			},
		},
		{
			command: `pnpm --filter @rondo/web exec next dev --port ${WEB_PORT}`,
			cwd: "..",
			url: `http://localhost:${WEB_PORT}/`,
			reuseExistingServer: false,
			timeout: 180_000,
			env: {
				NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SPECTATE_SERVER_PORT}/ws`,
				NEXT_PUBLIC_RONDO_SPECTATE_DEV: "1",
			},
		},
	],
});
