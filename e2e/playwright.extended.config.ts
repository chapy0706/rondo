/**
 * 拡張の E2E（issue-52）。make e2e には入れない（make e2e は今のまま）。
 *
 *   pnpm --filter @rondo/e2e e2e:extended
 *
 * - 端末設定: Desktop Chrome（desktop）、縦画面のスマホ Pixel 7（mobile-chrome）、iPhone 13 の WebKit
 *   （mobile-webkit。Safari と同じエンジンだが、実機の iPhone の代わりではない）
 * - 流すもの: issue-48 の主要シナリオ（smoke.e2e.ts）と、tests/extended/ の E2E（素材の失敗、
 *   テスト用の口、2本の指のタッチ、3D ではない画面の見た目の比較）
 *
 * 起動するもの:
 * - サーバー（3000。動いていれば使う）
 * - web（3102）。テスト用の口（NEXT_PUBLIC_RONDO_TEST_HOOKS=1）を有効にし、素材の基準 URL を実在しない
 *   ホストにする（tests/extended/assetRoutes.ts。リクエストはテストごとに page.route で差し替える）。
 *   make dev-all の web（3100）とは別に起動する（同じフォルダで next dev を2つ動かさないよう、
 *   make dev-all は止めておく）
 *
 * 初回だけ、ブラウザの取得が要る: pnpm --filter @rondo/e2e exec playwright install chromium webkit
 */

import { defineConfig, devices } from "@playwright/test";
import { ASSET_BASE_URL } from "./tests/extended/assetRoutes";
import { WAIT_MS } from "./timeouts";

const SERVER_PORT = 3000;
const WEB_PORT = 3102;

export default defineConfig({
	testDir: "./tests",
	testMatch: ["smoke.e2e.ts", "extended/**/*.e2e.ts"],
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: {
		timeout: WAIT_MS,
		// 見た目の比較: 画素の 1% までの差は許す。アニメーションは止めて撮る。
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.01,
			animations: "disabled",
			stylePath: "./tests/screenshot.css",
		},
	},
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		actionTimeout: WAIT_MS,
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
		{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
		{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
	],
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
			reuseExistingServer: false,
			timeout: 180_000,
			env: {
				NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
				NEXT_PUBLIC_ASSET_BASE_URL: ASSET_BASE_URL,
				NEXT_PUBLIC_RONDO_TEST_HOOKS: "1",
			},
		},
	],
});
