/**
 * ロビーのステージの選択肢（issue-46。apps/web の HIRAYA_READY が true のとき）。make e2e で流す。
 *
 * - ステージの選択肢が 2 つ（0 = ランダム間取り、1 = 平屋）出る
 * - 平屋を選ぶと、CPU の選択肢（隠れ側 CPU、鬼 CPU の強さ）が出ない。ランダム間取りへ戻すと、また出る
 *
 * 部品は、文言ではなく、data-testid（lobby-option-<key>）と値で探す。待ち時間は既定の 15 秒（timeouts.ts）。
 * ルームは作らない（ロビーの表示だけを見る）。
 */

import { expect } from "@playwright/test";
import { test } from "./flows";

test("ロビーに、ステージの選択肢が 2 つ出て、平屋を選ぶと CPU の選択肢が出ない", async ({
	openTab,
}) => {
	const { page } = await openTab();
	await page.goto("/lobby/veryare");

	const stage = page.getByTestId("lobby-option-stage");
	const cpu = page.getByTestId("lobby-option-cpu");
	const cpuStrength = page.getByTestId("lobby-option-cpuStrength");

	await expect(stage).toBeVisible();
	await expect(stage.locator("option")).toHaveCount(2);
	expect(
		await stage
			.locator("option")
			.evaluateAll((options) =>
				options.map((o) => (o as HTMLOptionElement).value),
			),
	).toEqual(["0", "1"]);
	// 既定はランダム間取り。CPU の選択肢が出ている。
	await expect(stage).toHaveValue("0");
	await expect(cpu).toBeVisible();
	await expect(cpuStrength).toBeVisible();

	await stage.selectOption("1");
	await expect(cpu).toHaveCount(0);
	await expect(cpuStrength).toHaveCount(0);

	await stage.selectOption("0");
	await expect(cpu).toBeVisible();
	await expect(cpuStrength).toBeVisible();
});
