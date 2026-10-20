/**
 * 終わったルームの自動閉鎖（issue-70 / ADR 0050）。playwright.expiry.config.ts で流す（サーバーの時間を
 * 1/20 に縮める。結果のあと、閉じるまで 9 秒）。make e2e には入れない。
 *
 * - 結果画面に、閉じるまでの残り（「あと ○ 秒で、ロビーへ戻ります」）が出て、時間がたつと、両方のタブが
 *   ロビーへ戻り、案内の枠（lobby-notice、data-code="room-expired"）が出る
 * - 結果のあと、全員が「退出する」で出たときは、これまでどおり（閉じる時刻を過ぎても、案内は出ない）
 */

import { expect } from "@playwright/test";
import { expectArea, roomWithTwo, test, touchArea } from "./flows";

/** 縮めた、結果のあとに閉じるまでの時間（3 分 / 20）。 */
const CLOSE_MS = 9_000;

test("結果のあと、時間がたつとルームが閉じ、両方のタブがロビーへ戻る @expiry", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(a, "green");
	// A が立候補して鬼になる。誰も撃たず、時間切れで結果まで進む（縮めた時間で数秒）。
	touchArea(a, roomId);
	for (const tab of [a, b]) {
		await expect(tab.page.getByTestId("result-screen")).toBeVisible({
			timeout: 60_000,
		});
		await expect(tab.page.getByTestId("result-closing")).toHaveText(
			/^あと \d+ 秒で、ロビーへ戻ります$/,
		);
	}
	for (const tab of [a, b]) {
		await expect(tab.page).toHaveURL(/\/lobby\/veryare$/, {
			timeout: CLOSE_MS + 10_000,
		});
		const notice = tab.page.getByTestId("lobby-notice");
		await expect(notice).toHaveAttribute("data-code", "room-expired");
		await expect(notice).toContainText("前のルームは、閉じられました");
	}
});

test("結果のあと、全員が退出したときは、これまでどおり（閉じたという案内は出ない） @expiry", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(a, "green");
	touchArea(a, roomId);
	for (const tab of [a, b]) {
		await expect(tab.page.getByTestId("result-screen")).toBeVisible({
			timeout: 60_000,
		});
	}
	for (const tab of [a, b]) {
		await tab.page.getByTestId("result-leave").click();
		await expect(tab.page).toHaveURL(/\/lobby\/veryare$/);
	}
	// 閉じる時刻を過ぎるまで待ち（何も起きないことを見るので、時間で待つ）、案内が出ないことを確かめる。
	await a.page.waitForTimeout(CLOSE_MS + 2_000);
	for (const tab of [a, b]) {
		await expect(
			tab.page.locator(
				'[data-testid="lobby-notice"][data-code="room-expired"]',
			),
		).toHaveCount(0);
	}
});
