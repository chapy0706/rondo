/**
 * テスト用の口は、環境変数（NEXT_PUBLIC_RONDO_TEST_HOOKS）なしでは存在しない（issue-52）。
 * make e2e（playwright.config.ts。web はテスト用の口なしで起動する）でだけ流す。拡張の E2E
 * （playwright.extended.config.ts）は口を有効にして起動するので、そちらでは流さない。
 */

import { expect } from "@playwright/test";
import { playNew, test } from "./flows";

test("テスト用の口は、環境変数なしでは window に無い", async ({ openTab }) => {
	const a = await openTab();
	await playNew(a);
	// ゲームの画面（3D のシーン）ができてから確かめる（口は、シーンができた後に作られるため）。
	await expect(a.page.getByTestId("veryare").locator("canvas")).toBeVisible();
	await expect(a.page.getByTestId("veryare")).toHaveAttribute(
		"data-phase",
		"oni-selection",
	);
	expect(await a.page.evaluate(() => "__rondoTest" in window)).toBe(false);
});
