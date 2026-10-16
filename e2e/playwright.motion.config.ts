/**
 * 体の動きの E2E（@motion / issue-57 の後半）。make e2e には入れない（素材の配信が要るため。
 * テストは e2e/motion/ にあり、make e2e の設定 playwright.config.ts の testDir（tests/）の外）。
 *
 *   pnpm --filter @rondo/e2e e2e:motion
 *
 * 前提:
 * - 配信するフォルダ（assets-src/delivery）に、キャラクターの体・ポーズの表・動きの glb と、
 *   manifest.json がある（docs/e2e.md の「体の動き」）
 * - make dev-all を止めておく（web を別の設定で起動するため。同じフォルダで next dev を2つ動かさない）
 *
 * 起動するもの（playwright.hiraya.config.ts と同じ形。ポートだけ変える）:
 * - サーバー（3000。動いていれば使う）
 * - 素材の配信（tools/serve-assets.mjs。8083。web のオリジン 3103 を許可する）
 * - web（3103。拡張の E2E の 3102・平屋の 3101 と重ねない）。素材の基準 URL、開発用の変数（ステージの選択肢）、テスト用の口
 *   （NEXT_PUBLIC_RONDO_TEST_HOOKS=1。動きの状態・止まりの記録を読み、移動の傾きを与える）を有効にする
 */

import { defineConfig, devices } from "@playwright/test";
import { WAIT_MS } from "./timeouts";

const SERVER_PORT = 3000;
const ASSET_PORT = 8083;
const WEB_PORT = 3103;

export default defineConfig({
	testDir: "./motion",
	testMatch: "**/*.e2e.ts",
	grep: /@motion/,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 300_000,
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
			reuseExistingServer: true,
			timeout: 120_000,
		},
		{
			command: `node tools/serve-assets.mjs --origin http://localhost:${WEB_PORT} --port ${ASSET_PORT}`,
			cwd: "..",
			url: `http://127.0.0.1:${ASSET_PORT}/manifest.json`,
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: `pnpm --filter @rondo/web exec next dev --port ${WEB_PORT}`,
			cwd: "..",
			url: `http://localhost:${WEB_PORT}/`,
			reuseExistingServer: false,
			timeout: 180_000,
			env: {
				NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
				NEXT_PUBLIC_ASSET_BASE_URL: `http://localhost:${ASSET_PORT}`,
				NEXT_PUBLIC_VERYARE_HIRAYA: "1",
				NEXT_PUBLIC_RONDO_TEST_HOOKS: "1",
			},
		},
	],
});
