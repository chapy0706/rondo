/**
 * 途中参加の人の操作部品（CPU ありのルーム）。ランダム間取りで CPU を加えたルームに、ロビーから入った
 * 人の画面で、移動パッドと鬼希望エリアが出て、移動パッドで動けることを確かめる（不具合: フェーズの
 * 通知が届かず、視点パッドだけが出ていた）。
 *
 * 画面の属性: data-controls（いま出している操作部品の一覧 / apps/web の controls.ts）、data-phase、
 * data-space。移動は、移動パッドを実際にマウスで倒し、そのタブがサーバーへ送った移動の報告で、位置が
 * 変わったことを確かめる（make e2e はテスト用の口なしで起動するため）。
 *
 * make e2e に入る代表の 2 本。組み合わせ（CPU の数・鬼・参加の順番・参加の時機）の網羅は、ボットの
 * 組み合わせ表（./tools/load.sh join）と、controls.ts のテストで行う。
 */

import { expect } from "@playwright/test";
import { type Tab, createFromLobby, joinFromLobby, test } from "./flows";

/** 画面の操作部品の一覧（data-controls）に、移動パッドと鬼希望エリアが入り、待っている表示が無い。 */
async function expectWaitingRoomControls(tab: Tab): Promise<void> {
	const root = tab.page.getByTestId("veryare");
	await expect(root).toHaveAttribute("data-phase", "oni-selection");
	await expect(root).toHaveAttribute("data-space", "waiting-room");
	await expect(root).toHaveAttribute("data-controls", /(^| )move( |$)/);
	await expect(root).toHaveAttribute("data-controls", /(^| )area( |$)/);
	await expect(root).not.toHaveAttribute("data-controls", /pending/);
	await expect(tab.page.getByLabel("仮想パッド（move）")).toBeVisible();
	await expect(tab.page.getByTestId("veryare-area")).toHaveAttribute(
		"data-color",
		"green",
	);
}

/** このタブが送った移動の報告の、最後の位置。 */
function lastSentPosition(tab: Tab): { x: number; z: number } | null {
	const moves = tab.link
		.sent("game-event")
		.map(
			(frame) =>
				frame.message.payload as { type?: unknown; x?: unknown; z?: unknown },
		)
		.filter(
			(p) =>
				p?.type === "move" &&
				typeof p.x === "number" &&
				typeof p.z === "number",
		);
	const last = moves.at(-1);
	return last === undefined
		? null
		: { x: last.x as number, z: last.z as number };
}

/**
 * 移動パッドをマウスで後ろへ倒し、少し待って離す。送った移動の報告の位置が、倒す前から変わる。前へ倒すと
 * 鬼希望エリア（中央の円）に触れて、カウントが始まってしまうので、後ろへ倒す。
 */
async function walkWithPad(tab: Tab): Promise<void> {
	const before = lastSentPosition(tab);
	const pad = tab.page.getByLabel("仮想パッド（move）");
	const box = await pad.boundingBox();
	if (box === null) throw new Error("移動パッドの位置が分からない");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await tab.page.mouse.move(cx, cy);
	await tab.page.mouse.down();
	await tab.page.mouse.move(cx, cy + box.height / 2, { steps: 5 });
	await tab.page.waitForTimeout(600);
	await tab.page.mouse.up();
	await expect
		.poll(() => {
			const now = lastSentPosition(tab);
			if (now === null) return false;
			return before === null || now.x !== before.x || now.z !== before.z;
		})
		.toBe(true);
}

test("CPU 1 体のルームに 2 人目が入ると、どちらの画面でも移動パッドと鬼希望エリアが出て、動ける", async ({
	openTab,
}) => {
	const a = await openTab();
	const b = await openTab();
	const roomId = await createFromLobby(a, { cpu: 1 });
	await joinFromLobby(b, roomId);
	await expectWaitingRoomControls(b);
	await expectWaitingRoomControls(a);
	await walkWithPad(b);
	await walkWithPad(a);
});

test("CPU 2 体のルームに 2 人目と 3 人目が入ると、全員の画面で移動パッドと鬼希望エリアが出て、動ける", async ({
	openTab,
}) => {
	const a = await openTab();
	const b = await openTab();
	const c = await openTab();
	const roomId = await createFromLobby(a, { cpu: 2 });
	await joinFromLobby(b, roomId);
	await joinFromLobby(c, roomId);
	for (const tab of [a, b, c]) await expectWaitingRoomControls(tab);
	await walkWithPad(c);
	await walkWithPad(b);
});
