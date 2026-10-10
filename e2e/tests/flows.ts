/**
 * シナリオに共通の操作（issue-48）。待ち時間は秒数ではなく、画面の状態で待つ。
 */

import {
	type Browser,
	type Page,
	test as base,
	expect,
} from "@playwright/test";
import { cellOf, centerOf, findPath, pickDoorShot } from "@rondo/bots/plan";
import { readStageNotice } from "@rondo/bots/stage";
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

// --- ステージと襖（issue-29d） ---------------------------------------------------------

/** このタブに届いた veryare の通知（game-state・game-state-to の payload）のうち、type が一致するもの。 */
export function receivedPayloads(
	tab: Tab,
	type: string,
): Record<string, unknown>[] {
	return tab.link.frames.flatMap(({ direction, message }) => {
		if (direction !== "received") return [];
		if (message.type !== "game-state" && message.type !== "game-state-to") {
			return [];
		}
		const payload = message.payload as Record<string, unknown> | undefined;
		return payload?.type === type ? [payload] : [];
	});
}

/** 画面のフェーズ（data-phase）を待つ。 */
export async function expectPhase(
	tab: Tab,
	phase: string,
	timeout: number,
): Promise<void> {
	await expect(tab.page.getByTestId("veryare")).toHaveAttribute(
		"data-phase",
		phase,
		{ timeout },
	);
}

/** 画面の開いている襖の数（data-open-doors）を待つ。 */
export async function expectOpenDoors(tab: Tab, count: number): Promise<void> {
	await expect(tab.page.getByTestId("veryare")).toHaveAttribute(
		"data-open-doors",
		String(count),
	);
}

/**
 * 鬼のタブから、玄関から閉じた襖の前まで1マスずつ歩き、その襖を開ける報告を送る（サーバーへの
 * 電文で代える）。襖と道は、ボットと同じ選び方（@rondo/bots/plan。10種の骨格で見つかることを
 * ボットのテストが確かめる）。
 */
export function walkAndOpenDoor(tab: Tab, roomId: string): void {
	const [notice] = receivedPayloads(tab, "stage");
	const stage = readStageNotice(notice);
	if (stage === null) throw new Error("ステージの通知が届いていない");
	const plan = pickDoorShot(stage);
	if (plan === null) throw new Error("開ける襖が見つからない");
	const path = findPath(stage, cellOf(stage, stage.spawn), plan.c, "closed");
	if (path === null) throw new Error("襖の前へ歩けない");
	const send = (payload: Record<string, unknown>) =>
		tab.link.inject({
			type: "game-event",
			gameType: "veryare",
			roomId,
			payload,
		});
	for (const cell of path) {
		send({ type: "move", ...centerOf(stage, cell) });
	}
	send({ type: "open-door", door: plan.door });
}

/** ステージの通知の襖（いつも開いている・いつも閉じている戸を除く）の数。 */
export function fusumaCount(tab: Tab): number {
	const [notice] = receivedPayloads(tab, "stage");
	const doors = (notice?.doors ?? []) as { kind?: unknown }[];
	return doors.filter((door) => door.kind === "fusuma").length;
}

// --- ペイント（issue-25） ---------------------------------------------------------------

/** このタブがサーバーへ送ったペイントの確定（game-event の payload.type が paint）の数。 */
export function sentPaintEvents(tab: Tab): number {
	return tab.link.frames.filter(({ direction, message }) => {
		if (direction !== "sent" || message.type !== "game-event") return false;
		const payload = message.payload as Record<string, unknown> | undefined;
		return payload?.type === "paint";
	}).length;
}

/**
 * このタブに、探索の開始の一括配信（hiders）より前に、ストロークのペイントを含む電文が
 * 届いたか（ペイントフェーズの間は、他の人のペイントを送らない / ADR 0025）。
 */
export function strokesBeforeHiders(tab: Tab): boolean {
	const received = tab.link.frames.filter((f) => f.direction === "received");
	const at = received.findIndex(({ message }) => {
		const payload = message.payload as Record<string, unknown> | undefined;
		return payload?.type === "hiders";
	});
	const before = at === -1 ? received : received.slice(0, at);
	return before.some(({ message }) =>
		JSON.stringify(message).includes('"strokes"'),
	);
}
