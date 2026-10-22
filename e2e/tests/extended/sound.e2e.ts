/**
 * 音（issue-63）の安全のための線。素材の配信を page.route で差し替え（assetRoutes.ts と同じホスト）、
 * 音の素材（mp3）への要求の有無と、Console の赤いエラーを見る。
 *
 * - 旗（?sound=1）があっても、manifest に audio 欄が無ければ（いまの本番）、音の素材を取りに行かない
 * - ?sound=0 で解除した端末は、audio 欄があっても、取りに行かない（その端末は無音のまま）
 * - 旗があり、audio 欄があって、mp3 が壊れていても、赤いエラーを出さずに、画面は続く
 */

import type { Page, Request, Route } from "@playwright/test";
import { expect } from "@playwright/test";
import { expectArea, joinFromLobby, playNew, test } from "../flows";
import { ASSET_BASE_URL, serveAssets } from "./assetRoutes";

const CORS = { "access-control-allow-origin": "*" };

/** audio 欄のある manifest（glb は無し）。 */
const MANIFEST_WITH_AUDIO = {
	version: 1,
	assets: [],
	audio: [
		{
			key: "bgm-top",
			kind: "bgm",
			version: 1,
			path: "v1/audio/bgm-top.mp3",
			bytes: 8,
			durationMs: 1000,
			gain: 1,
		},
		{
			key: "se-count",
			kind: "se",
			version: 1,
			path: "v1/audio/se-count.mp3",
			bytes: 8,
			durationMs: 1000,
			gain: 1,
		},
	],
};

/** audio 欄のある manifest を配る。mp3 は、先頭だけ ID3 の、壊れたバイト列。 */
async function serveWithAudio(page: Page): Promise<void> {
	await page.route(`${ASSET_BASE_URL}/**`, async (route: Route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/manifest.json") {
			await route.fulfill({
				status: 200,
				headers: CORS,
				json: MANIFEST_WITH_AUDIO,
			});
			return;
		}
		if (url.pathname.endsWith(".mp3")) {
			await route.fulfill({
				status: 200,
				headers: { ...CORS, "content-type": "audio/mpeg" },
				body: Buffer.from("ID3 これは音ではない"),
			});
			return;
		}
		await route.fulfill({ status: 404, headers: CORS, body: "" });
	});
}

/** 音の素材への要求と、Console の赤いエラーを集める。 */
function watch(page: Page): { mp3: string[]; errors: string[] } {
	const seen = { mp3: [] as string[], errors: [] as string[] };
	page.on("request", (request: Request) => {
		if (new URL(request.url()).pathname.endsWith(".mp3")) {
			seen.mp3.push(request.url());
		}
	});
	page.on("console", (message) => {
		if (message.type() === "error") seen.errors.push(message.text());
	});
	page.on("pageerror", (error) => seen.errors.push(String(error)));
	return seen;
}

/** 最初の操作（音の準備の合図）。 */
async function tap(page: Page): Promise<void> {
	await page.mouse.click(5, 5);
}

test("旗（?sound=1）があっても、audio 欄が無ければ、音の素材を取りに行かない", async ({
	openTab,
}) => {
	const a = await openTab();
	const seen = watch(a.page);
	await serveAssets(a.page, "ok");
	await a.page.goto("/select?sound=1");
	await tap(a.page);
	expect(
		await a.page.evaluate(() => localStorage.getItem("rondo.sound.enabled")),
	).toBe("1");
	await playNew(a);
	await tap(a.page);
	// 待機ルームの間に、先読み（game を含む）が走る時間を置く。
	await a.page.waitForTimeout(3000);
	expect(seen.mp3).toEqual([]);
	expect(seen.errors).toEqual([]);
});

test("?sound=0 の端末は、audio 欄があっても、音の素材を取りに行かない", async ({
	openTab,
}) => {
	const a = await openTab();
	const seen = watch(a.page);
	await serveWithAudio(a.page);
	await a.page.goto("/select?sound=0");
	await tap(a.page);
	await playNew(a);
	await tap(a.page);
	await a.page.waitForTimeout(3000);
	expect(seen.mp3).toEqual([]);
	expect(
		await a.page.evaluate(() => localStorage.getItem("rondo.sound.enabled")),
	).toBe("0");
});

test("旗があり、mp3 が壊れていても、赤いエラーを出さず、画面は続く", async ({
	openTab,
}) => {
	const a = await openTab();
	const b = await openTab();
	const seen = watch(a.page);
	await serveWithAudio(a.page);
	await a.page.goto("/select?sound=1");
	await tap(a.page);
	const roomId = await playNew(a);
	await tap(a.page);
	await expect
		.poll(() => seen.mp3.length, { timeout: 15_000 })
		.toBeGreaterThan(0);
	// 音の失敗の後も、画面は続く（2人目が入ると、円が緑になる）。
	await joinFromLobby(b, roomId);
	await expectArea(a, "green");
	expect(seen.errors).toEqual([]);
	// ?sound=0 で解除し、端末に覚える。
	await a.page.goto("/select?sound=0");
	expect(
		await a.page.evaluate(() => localStorage.getItem("rondo.sound.enabled")),
	).toBe("0");
});
