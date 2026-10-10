/**
 * シナリオ5（issue-48）: 鬼選出から結果画面まで。フェーズの時間は本番の既定のまま
 * （鬼選出のカウント 10 秒 → 準備 20 秒 → ペイント 20 秒 → 探索 40 秒 → 答え合わせ 20 秒、
 * 合わせて約 110 秒）。探索中の襖の開閉と、答え合わせの襖・点滅（issue-29d）、ペイントの確定と一括配信（issue-25）も確かめる。時間がかかるので @result を付け、`make e2e/result` で分けて動かす。
 */

import { expect } from "@playwright/test";
import {
	expectArea,
	expectOpenDoors,
	expectPhase,
	fusumaCount,
	receivedPayloads,
	roomWithTwo,
	sentPaintEvents,
	strokesBeforeHiders,
	test,
	touchArea,
	walkAndOpenDoor,
} from "./flows";

test("シナリオ5: 鬼選出から結果画面まで @result", async ({ openTab }) => {
	test.setTimeout(240_000);
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(a, "green");

	// A が中央の円に触れて、ただ1人の立候補者になる（A が鬼）。
	touchArea(a, roomId);
	await expectArea(b, "blue");

	// ペイント（issue-25）: B が自分の体（画面の中央）をタップして塗り、「塗り終わり」で確定する。
	const panel = b.page.getByTestId("veryare-paint");
	await expect(panel).toBeVisible({ timeout: 60_000 });
	await b.page.getByTestId("veryare").locator("canvas").click();
	await expect(panel).toHaveAttribute("data-strokes", "1");
	await b.page.getByTestId("veryare-paint-done").click();
	await expect(panel).toHaveAttribute("data-submitted", "true");

	// 探索の開始で、襖は全部閉じる。鬼（A）が襖の前まで歩いて開けると、両方のタブで開く
	// （issue-29d）。B は玄関に立ったまま、撃たれずに逃げ切る。
	for (const tab of [a, b]) await expectPhase(tab, "exploration", 90_000);
	for (const tab of [a, b]) await expectOpenDoors(tab, 0);
	// B のペイントは一度だけ送られ、A には探索の開始の一括配信で初めて届く（ADR 0025）。
	expect(sentPaintEvents(b)).toBe(1);
	await expect
		.poll(() => receivedPayloads(a, "hiders").length)
		.toBeGreaterThan(0);
	expect(strokesBeforeHiders(a)).toBe(false);
	const [hidersNotice] = receivedPayloads(a, "hiders");
	const [hider] = (hidersNotice?.hiders ?? []) as {
		paint?: { kind?: string; strokes?: unknown[] };
	}[];
	expect(hider?.paint?.kind).toBe("strokes");
	expect(hider?.paint?.strokes).toHaveLength(1);

	walkAndOpenDoor(a, roomId);
	for (const tab of [a, b]) await expectOpenDoors(tab, 1);

	// 答え合わせ: 襖が全部開き、隠れていた B が両方のタブで点滅の対象になる（ADR 0033）。
	for (const tab of [a, b]) {
		await expectPhase(tab, "reveal", 60_000);
		await expectOpenDoors(tab, fusumaCount(tab));
		await expect(tab.page.getByTestId("veryare")).toHaveAttribute(
			"data-blinking",
			"1",
		);
	}

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
