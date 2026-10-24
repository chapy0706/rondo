/**
 * 2タブの E2E スモーク（issue-48）。
 *
 * - make e2e: シナリオ1〜4（@result の付いていないもの）と、テスト用の口が無いことの確認（issue-52）と、
 *   iPhone の縦画面の収まりの代表の 2 画面（layout-fit.e2e.ts。WebKit。初回だけ
 *   `pnpm --filter @rondo/e2e exec playwright install webkit` が要る）
 * - pnpm --filter @rondo/e2e e2e:layout: iPhone の縦画面の収まりの、すべてのゲーム画面（@layout）
 * - make e2e/result: シナリオ5（鬼選出から結果画面まで。約2分。結果画面の見た目の比較を含む）
 *
 * スマホの端末設定・WebKit・素材の失敗・テスト用の口の E2E は、playwright.extended.config.ts（issue-52）。
 *
 * サーバーと web は、`make dev-all` と同じポートで起動する。すでに `make dev-all` が
 * 動いていれば、それを使う（reuseExistingServer）。web は実接続（Gleam サーバー）で動く。
 * 同じサーバーのルームを使い回すので、テストは1本ずつ順に動かす（workers: 1）。
 */

import { defineConfig, devices } from "@playwright/test";
import { WAIT_MS } from "./timeouts";

const SERVER_PORT = 3000;
const WEB_PORT = 3100;

/** iPhone の縦画面の収まり（layout-fit.e2e.ts）。WebKit の iPhone で、大きさはテストの側で決める。 */
const LAYOUT_TEST = "layout-fit.e2e.ts";

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.e2e.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: {
		timeout: WAIT_MS,
		// 見た目の比較（issue-52）: 画素の 1% までの差は許す。アニメーションは止めて撮る。
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
		{
			// 名前を付けない（基準画像の名前を、これまでと変えない）。
			use: { ...devices["Desktop Chrome"] },
			// 拡張の E2E（テスト用の口と、素材の差し替えが要る）は、playwright.extended.config.ts で流す。
			// 終わったルームの自動閉鎖（expiry.e2e.ts）は、時間を縮めたサーバーで、playwright.expiry.config.ts
			// から流す。
			// 観戦ルーム（spectate.e2e.ts）は、観戦ルームを受け付けるサーバーで、playwright.spectate.config.ts
			// から流す（issue-67）。
			testIgnore: [
				"extended/**",
				LAYOUT_TEST,
				"expiry.e2e.ts",
				"spectate.e2e.ts",
			],
		},
		{
			name: "iphone-webkit",
			use: { ...devices["iPhone 13"] },
			testMatch: LAYOUT_TEST,
		},
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
			reuseExistingServer: true,
			timeout: 180_000,
			env: {
				NEXT_PUBLIC_RONDO_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
				// 動ける隠れ側の規則の選択肢を、ロビーに出す（ADR 0053。既定は従来なので、ほかの試験は変わらない）。
				NEXT_PUBLIC_VERYARE_ROAMING: "1",
			},
		},
	],
});
