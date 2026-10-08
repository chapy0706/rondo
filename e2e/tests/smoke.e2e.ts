/**
 * 2タブの E2E スモーク（issue-48）。実接続（Gleam サーバー）で、主要な流れを確かめる。
 * 時間は既定値のまま: 再接続猶予 10 秒（ADR 0013）、ping 20 秒（issue-41）、
 * 返事の待ち 10 秒（issue-47）。
 */

import { expect } from "@playwright/test";
import {
	expectArea,
	joinFromLobby,
	playNew,
	roomWithTwo,
	test,
	touchArea,
} from "./flows";

test("シナリオ1: 入口と同期（新しく遊ぶ・ルームに参加する、円の色が両方で揃う）", async ({
	openTab,
}) => {
	const a = await openTab();
	const b = await openTab();
	const roomId = await playNew(a);
	// 1人のうちは赤（待機）。
	await expectArea(a, "red");

	await joinFromLobby(b, roomId);
	// 2人そろうと緑（開始）。両方で揃う。
	await expectArea(a, "green");
	await expectArea(b, "green");

	// 誰かが中央の円に触れると青（鬼希望のカウント中）。両方で揃う。
	touchArea(a, roomId);
	await expectArea(a, "blue");
	await expectArea(b, "blue");
});

test("シナリオ2a: 切断と復帰（猶予内に戻れば、同じルームで続く）", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(b, "green");
	const joinedBefore = b.link.received("room-joined").length;

	await b.link.goOffline();
	// 猶予（10 秒）より短い間だけ遮断する。
	await b.page.waitForTimeout(3_000);
	await b.link.goOnline();

	// つなぎ直して、同じルームへの復帰を頼み、新しい room-joined で受け入れられる。
	await expect
		.poll(() => b.link.sent("reconnect").at(-1)?.message.roomId)
		.toBe(roomId);
	await expect
		.poll(() => b.link.received("room-joined").length)
		.toBeGreaterThan(joinedBefore);
	expect(b.link.roomId()).toBe(roomId);
	// A には離脱が伝わっていない（緑のまま）。復帰後も同期が続く。
	await expectArea(a, "green");
	touchArea(a, roomId);
	await expectArea(b, "blue");
	await expect(b.page.getByTestId("room-error")).toHaveCount(0);
});

test("シナリオ2b: 切断と復帰（猶予を過ぎると離脱が確定し、失敗の表示が出る）", async ({
	openTab,
}) => {
	const { a, b } = await roomWithTwo(openTab);
	await expectArea(a, "green");

	await b.link.goOffline();
	// 猶予（10 秒）を過ぎると、サーバーで離脱が確定し、A は1人に戻る（赤）。
	await expectArea(a, "red");
	await b.link.goOnline();

	// B は復帰を頼むが、戻れず、失敗の表示が出る。
	await expect(b.page.getByTestId("room-error")).toBeVisible({
		timeout: 20_000,
	});
	await expect(b.page.getByTestId("room-error")).toContainText(
		"前の接続に戻れませんでした",
	);
});

test("シナリオ3: ハートビート（ping が約20秒ごとに届き、pong を返す）", async ({
	openTab,
}) => {
	test.setTimeout(90_000);
	const a = await openTab();
	await playNew(a);

	// ping を2通待つ。
	await expect
		.poll(() => a.link.received("ping").length, { timeout: 60_000 })
		.toBeGreaterThanOrEqual(2);
	const pings = a.link.received("ping");
	const gap = (pings[1]?.at ?? 0) - (pings[0]?.at ?? 0);
	expect(gap).toBeGreaterThan(15_000);
	expect(gap).toBeLessThan(25_000);

	// それぞれの ping の後に pong を返している。
	for (const ping of pings.slice(0, 2)) {
		expect(a.link.sent("pong").some((pong) => pong.at >= ping.at)).toBe(true);
	}
	await expect(a.page.getByTestId("connection-failed")).toHaveCount(0);
});

test("シナリオ4: 接続の失敗（遮断したまま新しく遊ぶ → 約10秒で失敗 → もう一度で入れる）", async ({
	openTab,
}) => {
	const a = await openTab();
	await a.link.goOffline();
	await a.page.goto("/select");
	await a.page.getByRole("link", { name: "veryare", exact: true }).click();
	await a.page.getByRole("link", { name: "新しく遊ぶ" }).click();
	const started = Date.now();

	// 「つながりません」の表示の枠。ボタンはこの中で探す（画面の下の「ゲーム選択へ戻る」と
	// 名前の一部が重なるため）。
	const failed = a.page.getByTestId("connection-failed");
	await expect(failed).toBeVisible({ timeout: 20_000 });
	expect(Date.now() - started).toBeGreaterThan(7_000);
	await expect(failed.getByRole("button", { name: "ロビーへ" })).toBeVisible();
	await expect(
		failed.getByRole("button", { name: "ゲーム選択へ" }),
	).toBeVisible();

	await a.link.goOnline();
	await failed.getByRole("button", { name: "もう一度" }).click();
	await expect(a.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => a.link.roomId()).not.toBeNull();
});
