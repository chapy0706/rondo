/**
 * シナリオに共通の操作（issue-48）。待ち時間は秒数ではなく、画面の状態で待つ。
 */

import {
	type Browser,
	type Locator,
	type Page,
	test as base,
	expect,
} from "@playwright/test";
import { cellOf, centerOf, findPath, pickDoorShot } from "@rondo/bots/plan";
import { readStageNotice } from "@rondo/bots/stage";
import { WsLink } from "./wsLink";

/**
 * veryare の識別子（マニフェストの id = gameType）。選択画面のカードと、選択中の名前は、表示名では
 * なく、この識別子の属性（data-game）で探す（issue-69。表示名を変えても壊れない）。
 */
const VERYARE_ID = "veryare";

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

/**
 * 選択画面で veryare を選ぶ（中央へ寄せると、入口のボタンが出る）。veryare は棚の先頭で、開いた
 * ときから選択中のことがある（issue-46 で先頭へ移した）。選択中のカードを押すとゲームが起動して
 * しまうので、選択中でないときだけカードを押して中央へ寄せる。カードと選択中の名前は、識別子の
 * 属性（data-game）で探す（issue-69）。
 */
export async function chooseVeryare(page: Page): Promise<void> {
	await page.goto("/select");
	const current = page.getByTestId("shelf-current");
	await expect(current).toBeVisible();
	if ((await current.getAttribute("data-game")) !== VERYARE_ID) {
		await page.locator(`a[data-game="${VERYARE_ID}"]`).click();
	}
	await expect(current).toHaveAttribute("data-game", VERYARE_ID);
	await expect(page.getByRole("link", { name: "新しく遊ぶ" })).toBeVisible();
}

/**
 * 選択画面の「新しく遊ぶ」から、ルームを作って入る。ルーム ID を返す。veryare では、クライアントの既定の
 * 規則（動ける隠れ側 / apps/web の manifest.ts の ROAMING_DEFAULT）のルームになる。規則に依存する試験は、
 * classicRoomWithTwo か roamingRoomWithTwo で、規則を明示する。
 */
export async function playNew(tab: Tab): Promise<string> {
	await chooseVeryare(tab.page);
	await tab.page.getByRole("link", { name: "新しく遊ぶ" }).click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).not.toBeNull();
	return tab.link.roomId() as string;
}

/**
 * ロビーの一覧で、識別子 roomId のルームの参加ボタン。一覧には識別子を文字として出さない（issue-58）
 * ので、行の入れ物の属性（data-room-id）で探す。同じ名前のルームが並んでも（表示名の番号の使い回し /
 * issue-71）、取り違えない。
 */
export function lobbyRow(page: Page, roomId: string): Locator {
	return page
		.locator(`[data-room-id=${JSON.stringify(roomId)}]`)
		.getByTestId("lobby-room");
}

/** 選択画面の「ルームに参加する」から、ロビーで指定のルームに入る。 */
export async function joinFromLobby(tab: Tab, roomId: string): Promise<void> {
	await chooseVeryare(tab.page);
	await tab.page.getByRole("link", { name: "ルームに参加する" }).click();
	await expect(tab.page).toHaveURL(/\/lobby\/veryare$/);
	await lobbyRow(tab.page, roomId).click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).toBe(roomId);
}

/**
 * ロビーの作成フォームの選択肢（apps/web の roomOptions の key と、選択肢の値）。文言（ラベル・選択肢の
 * 表示名）ではなく、data-testid（lobby-option-<key>）と値で選ぶ。
 */
export interface LobbySettings {
	/** 0 = ランダム間取り、1 = 平屋（平屋では、CPU の選択肢が出ない。cpu・cpuStrength は渡さない）。 */
	readonly stage?: number;
	readonly explorationSeconds?: number;
	/** 0 = なし、1〜3 = 隠れ側 CPU の数、4 = 鬼 CPU。 */
	readonly cpu?: number;
	readonly cpuStrength?: number;
	/** 0 = 従来、1 = 動ける隠れ側（ADR 0053。ロビーの既定の選択は 1）。 */
	readonly roaming?: number;
	/** 0 = ふつう、1 = 増え鬼（ADR 0053。ロビーの既定の選択は 0）。 */
	readonly spreading?: number;
}

/** ロビー（/lobby/veryare）を開き、settings を選んで「新しいルームを作る」を押す。ルーム ID を返す。 */
export async function createFromLobby(
	tab: Tab,
	settings: LobbySettings = {},
): Promise<string> {
	await tab.page.goto("/lobby/veryare");
	for (const [key, value] of Object.entries(settings)) {
		if (value === undefined) continue;
		await tab.page
			.getByTestId(`lobby-option-${key}`)
			.selectOption(String(value));
	}
	await tab.page.getByTestId("lobby-create-room").click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).not.toBeNull();
	return tab.link.roomId() as string;
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

/**
 * A がロビーで動ける隠れ側の規則（ADR 0053）で作り、B がロビーから入った、2人のルーム。本番と同じ道を通る:
 * A は、まず選択画面を ?rules=1 で開き（新しい規則の入口。端末に覚える）、そのあと、URL に何も付けずに
 * ロビーを開いて、選択肢を選ぶ。作成の電文の settings に roaming: 1 が載ったことを確かめる。
 */
export async function roamingRoomWithTwo(
	open: () => Promise<Tab>,
): Promise<{ a: Tab; b: Tab; roomId: string }> {
	const a = await open();
	const b = await open();
	// 開発サーバーは、初めて開くページを組み立てるときに、開いているページを読み込み直すことがある（WebKit で、
	// 選択画面からロビーへの移動が打ち消された）。B のタブで、先にロビーを組み立てておく。
	await b.page.goto("/lobby/veryare");
	await a.page.goto("/select?rules=1");
	await expect(a.page.getByTestId("shelf-current")).toBeVisible();
	// 入口が端末に覚えてから（ルートの RulesEntryRoot）、ロビーへ移る。開発サーバーの初回の組み立てで、ページが
	// 読み込み直されることがあるので、読み込みの終わりも待つ。
	await expect
		.poll(() =>
			a.page.evaluate(() => localStorage.getItem("rondo.lobby.rules")),
		)
		.toBe("on");
	await a.page.waitForLoadState("load");
	const roomId = await createFromLobby(a, { roaming: 1 });
	const created = a.link.sent("create-room").at(-1)?.message.settings as
		| Record<string, unknown>
		| undefined;
	expect(created?.roaming).toBe(1);
	await joinFromLobby(b, roomId);
	return { a, b, roomId };
}

/**
 * A がロビーで従来の規則（隠れ側の動き: その場から動けない）を選んで作り、B がロビーから入った、2 人のルーム。
 * 従来の規則に依存する試験（ペイントの確定、探索中の隠れ側が動けない、襖のボタン）が使う。作成の電文の
 * settings に roaming: 0 が載ったことを確かめる。
 */
export async function classicRoomWithTwo(
	open: () => Promise<Tab>,
): Promise<{ a: Tab; b: Tab; roomId: string }> {
	const a = await open();
	const b = await open();
	const roomId = await createFromLobby(a, { roaming: 0 });
	const created = a.link.sent("create-room").at(-1)?.message.settings as
		| Record<string, unknown>
		| undefined;
	expect(created?.roaming).toBe(0);
	await joinFromLobby(b, roomId);
	return { a, b, roomId };
}

/**
 * A が「新しく遊ぶ」で作り、B がロビーから入った、2人のルーム。規則は、クライアントの既定（動ける隠れ側）。
 * 規則に依存しない試験（待機ルーム・接続・ステージの通知など）が使う。
 */
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

// --- 待機ルームのメンバー（issue-59） --------------------------------------------------------

/** 描画の入れ物に出る、見えている他のメンバーの人数（data-visible-members）を待つ。 */
export async function expectVisibleMembers(
	tab: Tab,
	count: number,
	timeout?: number,
): Promise<void> {
	await expect(tab.page.getByTestId("veryare-view")).toHaveAttribute(
		"data-visible-members",
		String(count),
		timeout === undefined ? {} : { timeout },
	);
}

/** 描画の入れ物に出る、見えている他のメンバーの待機ポーズ（data-member-poses。通知の順）を待つ。 */
export async function expectMemberPoses(
	tab: Tab,
	poses: string,
): Promise<void> {
	await expect(tab.page.getByTestId("veryare-view")).toHaveAttribute(
		"data-member-poses",
		poses,
	);
}

/** このタブのプレイヤーの待機ポーズを変える（サーバーへの電文で代える。素材なしでボタンが出ないため）。 */
export function changeWaitingPose(
	tab: Tab,
	roomId: string,
	pose: string,
): void {
	tab.link.inject({
		type: "game-event",
		gameType: "veryare",
		roomId,
		payload: { type: "waiting-pose", pose },
	});
}

/** このタブのプレイヤーを、待機ルームの (x, z) へ動かす（サーバーへの電文で代える）。 */
export function moveInWaitingRoom(
	tab: Tab,
	roomId: string,
	x: number,
	z: number,
): void {
	tab.link.inject({
		type: "game-event",
		gameType: "veryare",
		roomId,
		payload: { type: "move", x, z },
	});
}
