/**
 * 平屋の E2E（@hiraya / issue-46 の続き）。make e2e には入れない（素材の配信が要るため）。
 *
 *   pnpm --filter @rondo/e2e e2e:hiraya
 *
 * 前提:
 * - 配信するフォルダ（assets-src/delivery）に、平屋の glb と家具の箱の glb、manifest.json がある
 *   （docs/e2e.md の「平屋のステージ」）
 * - make dev-all を止めておく（web を別の設定で起動するため。同じフォルダで next dev を2つ動かさない）
 *
 * 起動するもの:
 * - サーバー（3000。動いていれば使う）
 * - 素材の配信（tools/serve-assets.mjs。8081。web のオリジン 3101 を許可する）
 * - web（3101）。素材の基準 URL、平屋の選択肢（開発用の変数）、テスト用の口
 *   （NEXT_PUBLIC_RONDO_TEST_HOOKS=1）を有効にして起動する
 */

import { defineConfig, devices } from "@playwright/test";
import { WAIT_MS } from "./timeouts";

const SERVER_PORT = 3000;
const ASSET_PORT = 8081;
const WEB_PORT = 3101;

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.e2e.ts",
	grep: /@hiraya/,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 240_000,
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
