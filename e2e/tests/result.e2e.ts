/**
 * シナリオ5（issue-48）: 鬼選出から結果画面まで。フェーズの時間は本番の既定のまま
 * （鬼選出のカウント 10 秒 → 準備 20 秒 → ペイント 20 秒 → 探索 40 秒 → 答え合わせ 20 秒、
 * 合わせて約 110 秒）。時間がかかるので @result を付け、`make e2e/result` で分けて動かす。
 */

import { expect } from "@playwright/test";
import { expectArea, roomWithTwo, test, touchArea } from "./flows";

test("シナリオ5: 鬼選出から結果画面まで @result", async ({ openTab }) => {
	test.setTimeout(240_000);
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(a, "green");

	// A が中央の円に触れて、ただ1人の立候補者になる（A が鬼）。
	touchArea(a, roomId);
	await expectArea(b, "blue");

	// 誰も見つからないまま探索が時間切れ → 答え合わせ → 終了。両方が結果画面へ移る。
	for (const tab of [a, b]) {
		await expect(tab.page.getByTestId("result-screen")).toBeVisible({
			timeout: 180_000,
		});
	}
	// 隠れ側（B）のチームが 1 位、鬼（A）が 2 位（issue-42 の写し方）。
	const screen = b.page.getByTestId("result-screen");
	await expect(screen).toContainText("1位");
	await expect(screen).toContainText("2位");
	await expect(screen).toContainText("隠れる側");
	await expect(screen).toContainText("逃げ切り");
	// 結果画面から、ロビーへ戻れる。
	await b.page.getByRole("button", { name: "退出する" }).click();
	await expect(b.page).toHaveURL(/\/lobby\/veryare$/);
});
