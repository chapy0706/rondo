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
 *
 * パッドは、ゲーム画面の下（描画の下）にあり、Desktop Chrome（1280×720）では画面の外に出る。マウスの
 * 操作は画面の中の座標にしか届かない（toBeVisible は画面の外でも通る）ので、先にパッドを画面の中へ
 * 寄せ、画面の中にあることを確かめてから倒す。パッドはポインターのイベント（マウスでもタッチでも）を
 * 受ける（game-sdk の virtual-pad.tsx）。失敗したら、パッドの位置と大きさ・画面の大きさ・そのタブが送った
 * 直近の電文 10 件を、レポートに添付する。
 */
async function walkWithPad(tab: Tab, label: string): Promise<void> {
	const before = lastSentPosition(tab);
	const pad = tab.page.getByLabel("仮想パッド（move）");
	await pad.scrollIntoViewIfNeeded();
	const box = await pad.boundingBox();
	const viewport = tab.page.viewportSize();
	try {
		if (box === null) throw new Error("移動パッドの位置が分からない");
		if (
			viewport !== null &&
			(box.y < 0 ||
				box.y + box.height > viewport.height ||
				box.x < 0 ||
				box.x + box.width > viewport.width)
		) {
			throw new Error("移動パッドが、画面の中に収まっていない");
		}
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;
		await tab.page.mouse.move(cx, cy);
		await tab.page.mouse.down();
		// パッドの中で、半径の 9 割まで後ろへ倒す（縁の外へは出さない）。
		await tab.page.mouse.move(cx, cy + box.height * 0.45, { steps: 5 });
		await tab.page.waitForTimeout(600);
		await tab.page.mouse.up();
		await expect
			.poll(() => {
				const now = lastSentPosition(tab);
				if (now === null) return false;
				return before === null || now.x !== before.x || now.z !== before.z;
			})
			.toBe(true);
	} catch (error) {
		await test.info().attach(`${label}: パッドと送った電文`, {
			contentType: "application/json",
			body: JSON.stringify(
				{
					pad: box,
					viewport,
					scrollY: await tab.page.evaluate(() => window.scrollY),
					controls: await tab.page
						.getByTestId("veryare")
						.getAttribute("data-controls"),
					before,
					sent: tab.link.frames
						.filter((frame) => frame.direction === "sent")
						.slice(-10),
				},
				null,
				2,
			),
		});
		throw error;
	}
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
	await walkWithPad(b, "2 人目");
	await walkWithPad(a, "1 人目");
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
	await walkWithPad(c, "3 人目");
	await walkWithPad(b, "2 人目");
});
