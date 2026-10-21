/**
 * ゲームのロゴ（issue-69）。ロゴの画像（apps/web/public/games/<識別子>/logo.svg・logo.webp）が読めるときは画像が
 * 出て、読めないとき（リクエストを中止・404）は、壊れた画像を出さず、背景の色と頭文字の仮のタイル
 * だけが出ることを確かめる。素材の失敗の E2E（assets.e2e.ts）と同じく、page.route で差し替える。
 *
 * カードは、表示名ではなく、識別子の属性（data-game）で探す。
 */

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "../flows";

/** 選択画面の veryare のカードの、ロゴの部品。 */
function veryareLogo(page: Page) {
	return page.locator('a[data-game="veryare"] [data-testid="game-logo"]');
}

/** ページの中に、読み終わって大きさが 0 の画像（壊れた画像）が、いくつあるか。 */
function brokenImages(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			Array.from(document.images).filter(
				(img) => img.complete && img.naturalWidth === 0,
			).length,
	);
}

test("ロゴが読めるときは、選択画面のカードに画像が出る", async ({
	openTab,
}) => {
	const a = await openTab();
	await a.page.goto("/select");
	const logo = veryareLogo(a.page);
	await expect(logo).toHaveAttribute("data-logo", "image");
	const img = logo.locator("img");
	await expect(img).toHaveAttribute("alt", "すごくアレ");
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);
});

for (const [name, failure] of [
	["中止", "abort"],
	["404", "404"],
] as const) {
	test(`ロゴが読めないとき（${name}）は、仮のタイルだけが出る（壊れた画像を出さない）`, async ({
		openTab,
	}) => {
		const a = await openTab();
		await a.page.route(/\/games\/[^/]+\/logo\.(svg|webp)$/, (route) =>
			failure === "abort"
				? route.abort()
				: route.fulfill({ status: 404, body: "not found" }),
		);
		await a.page.goto("/select");
		const logo = veryareLogo(a.page);
		await expect(logo).toHaveAttribute("data-logo", "tile");
		await expect(logo.locator("img")).toHaveCount(0);
		// タイルの頭文字（すごくアレ → す）が見える。
		await expect(logo).toContainText("す");
		await expect.poll(() => brokenImages(a.page)).toBe(0);
		// 画面は崩れない（中央の名前と、入口のボタンが出る）。
		await expect(a.page.getByTestId("shelf-current")).toHaveAttribute(
			"data-game",
			"veryare",
		);
	});
}
