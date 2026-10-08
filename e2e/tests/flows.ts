/**
 * シナリオに共通の操作（issue-48）。待ち時間は秒数ではなく、画面の状態で待つ。
 */

import {
	type Browser,
	type Page,
	test as base,
	expect,
} from "@playwright/test";
import { WsLink } from "./wsLink";

/** ゲーム名（マニフェストの title）。選択画面のカードの名前に使う。 */
const VERYARE_TITLE = "veryare";

export interface Tab {
	readonly page: Page;
	readonly link: WsLink;
}

/** 別のブラウザコンテキスト（別のプレイヤー）で、タブを1つ開く。 */
async function openTab(browser: Browser): Promise<Tab> {
	const context = await browser.newContext();
	const page = await context.newPage();
	const link = await WsLink.attach(page);
	return { page, link };
}

/**
 * テストごとにタブを開く口（openTab）を持つ test。終わったら、各タブのルームから
 * 退出してから閉じる（同時ルーム数の上限 3 に、前のテストのルームを残さないため）。
 */
export const test = base.extend<{ openTab: () => Promise<Tab> }>({
	openTab: async ({ browser }, use) => {
		const tabs: Tab[] = [];
		await use(async () => {
			const tab = await openTab(browser);
			tabs.push(tab);
			return tab;
		});
		for (const tab of tabs) {
			const roomId = tab.link.roomId();
			if (roomId !== null && tab.link.connected()) {
				tab.link.inject({ type: "leave-room", roomId });
			}
			await tab.page.context().close();
		}
	},
});

/** 選択画面で veryare を選ぶ（中央へ寄せると、入口のボタンが出る）。 */
async function chooseVeryare(page: Page): Promise<void> {
	await page.goto("/select");
	const card = page.getByRole("link", { name: VERYARE_TITLE, exact: true });
	await card.click();
	await expect(page.getByRole("link", { name: "新しく遊ぶ" })).toBeVisible();
}

/** 選択画面の「新しく遊ぶ」から、ルームを作って入る。ルーム ID を返す。 */
export async function playNew(tab: Tab): Promise<string> {
	await chooseVeryare(tab.page);
	await tab.page.getByRole("link", { name: "新しく遊ぶ" }).click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).not.toBeNull();
	return tab.link.roomId() as string;
}

/** 選択画面の「ルームに参加する」から、ロビーで指定のルームに入る。 */
export async function joinFromLobby(tab: Tab, roomId: string): Promise<void> {
	await chooseVeryare(tab.page);
	await tab.page.getByRole("link", { name: "ルームに参加する" }).click();
	await expect(tab.page).toHaveURL(/\/lobby\/veryare$/);
	await tab.page.getByRole("button", { name: new RegExp(roomId) }).click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).toBe(roomId);
}

/** 鬼希望エリアの円の色（red / green / blue）を待つ。 */
export async function expectArea(tab: Tab, color: string): Promise<void> {
	await expect(tab.page.getByTestId("veryare-area")).toHaveAttribute(
		"data-color",
		color,
	);
}

/** このタブのプレイヤーを、鬼希望エリアの中央へ動かす（サーバーへの電文で代える）。 */
export function touchArea(tab: Tab, roomId: string): void {
	tab.link.inject({
		type: "game-event",
		gameType: "veryare",
		roomId,
		payload: { type: "move", x: 0, z: 0 },
	});
}

/** A が作り、B がロビーから入った、2人のルーム。 */
export async function roomWithTwo(
	open: () => Promise<Tab>,
): Promise<{ a: Tab; b: Tab; roomId: string }> {
	const a = await open();
	const b = await open();
	const roomId = await playNew(a);
	await joinFromLobby(b, roomId);
	return { a, b, roomId };
}
