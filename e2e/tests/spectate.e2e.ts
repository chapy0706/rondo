/**
 * 観戦ルーム（issue-67）。playwright.spectate.config.ts で流す（観戦ルームを受け付けるサーバーと web を、
 * 別のポートで起動する。フェーズ時間は 1/4）。make e2e には入れない。
 *
 * - ボット（@rondo/bots のクライアント）が観戦ルームを作る（作った人も観戦者）。ブラウザは、ロビーの一覧の
 *   「観戦」の行から入り、観戦の画面（data-spectating）で、全員の体が見える（data-visible-actors）
 * - 下の選択で、追う相手を替えられる（data-follow-target）
 * - 結果のあと「次の試合まで あと ○ 秒」が出て、次の試合が始まり、選んだ相手を追い続ける
 * - iPhone の縦画面で、観戦の画面がスクロールなしで収まる（@layout。layout-fit.e2e.ts と同じ測り方）
 * - ロビーの、観戦ルームを作るトグルは、運営の画面（?operator=1）だけに出る。トグルから作ると、作った人は
 *   観戦者として入る（隠れ CPU の数を選べる）
 *
 * 観戦ルームは同時に 1 つまで（ADR 0051）。前のテストのルームが、0 人で閉じる（60 秒 / 4）まで、作り直しを
 * 待つ。終わったら、ボットはルームを出て閉じる。
 */

import { expect } from "@playwright/test";
import { Bot } from "@rondo/bots/client";
import { type Tab, test } from "./flows";
import { LAYOUT_SIZES, checkLayout } from "./layout";

/** 観戦ルームを受け付けるサーバー（playwright.spectate.config.ts の 3005）。 */
const SERVER_URL = "ws://localhost:3005/ws";

/** 縮めた、0 人で閉じるまで（60 秒 / 4）。前のテストの観戦ルームが閉じるのを待つ上限に使う。 */
const IDLE_CLOSE_MS = 15_000;

/** ボットで観戦ルームを作る（隠れ CPU 3 体）。観戦の枠が空くまで、作り直す。ルーム ID を返す。 */
async function createSpectateRoom(bot: Bot): Promise<string> {
	const deadline = Date.now() + IDLE_CLOSE_MS + 15_000;
	for (;;) {
		const since = bot.received.length;
		bot.send({
			type: "create-room",
			gameType: "veryare",
			roomName: "観戦の E2E",
			settings: { spectate: 1, hiderCpus: 3 },
		});
		const reply = await bot.waitFor(
			(m) =>
				(m.type === "room-joined" || m.type === "error") &&
				bot.received.findIndex((r) => r.message === m) >= since,
			5_000,
			"room-joined か error",
		);
		if (reply.type === "room-joined") return reply.roomId;
		expect(reply.type === "error" && reply.code).toBe("room-limit");
		if (Date.now() > deadline) throw new Error("観戦の枠が空かない");
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
}

function leave(bot: Bot): void {
	for (const joined of bot.all("room-joined")) {
		bot.send({ type: "leave-room", roomId: joined.roomId });
	}
	bot.close();
}

/** ロビーの一覧の「観戦」の行から入り、観戦の画面が出るまで待つ。 */
async function watchFromLobby(tab: Tab, roomId: string): Promise<void> {
	await tab.page.goto("/lobby/veryare");
	const row = tab.page.locator(
		'[data-testid="lobby-room"][data-availability="spectate"]',
	);
	await expect(row).toBeEnabled({ timeout: 10_000 });
	await expect(row).toContainText("観戦");
	await row.click();
	const view = tab.page.getByTestId("veryare-spectate");
	await expect(view).toHaveAttribute("data-spectating", "true");
	await expect.poll(() => tab.link.roomId()).toBe(roomId);
	await expect(tab.page.getByTestId("play-spectating")).toHaveText("観戦中");
}

function visibleActors(tab: Tab): Promise<number> {
	return tab.page
		.getByTestId("veryare-spectate")
		.getAttribute("data-visible-actors")
		.then((value) => Number(value ?? "0"));
}

test("ボットの観戦ルームに、ロビーから入り、全員の体が見え、追う相手を替えられ、次の試合も追い続ける @spectate", async ({
	openTab,
}) => {
	const bot = await Bot.connect(
		SERVER_URL,
		"spectate-bot",
		(url) => new WebSocket(url),
	);
	try {
		const roomId = await createSpectateRoom(bot);
		const a = await openTab();
		await watchFromLobby(a, roomId);
		const view = a.page.getByTestId("veryare-spectate");

		// 全員の体（準備移動では隠れ CPU 3 体、探索からは鬼 CPU も）が見える。
		await expect
			.poll(() => visibleActors(a), { timeout: 30_000 })
			.toBeGreaterThanOrEqual(3);
		// 操作の部品は出ない。
		for (const id of [
			"veryare-move-pad",
			"veryare-look-pad",
			"veryare-shoot",
		]) {
			await expect(a.page.getByTestId(id)).toHaveCount(0);
		}

		// 下の選択で、隠れ 2 を追う。
		const choices = a.page.getByTestId("spectate-follow");
		await expect(choices).toHaveCount(4);
		const second = choices.filter({ hasText: "隠れ 2" });
		const chosen = await second.getAttribute("data-actor");
		expect(chosen).not.toBeNull();
		await second.click();
		await expect(view).toHaveAttribute("data-follow-target", chosen as string);
		await expect(second).toHaveAttribute("aria-pressed", "true");

		// 結果のあと、次の試合までの残りが出る。
		await expect(view).toHaveAttribute("data-phase", "ended", {
			timeout: 90_000,
		});
		await expect(a.page.getByTestId("spectate-status")).toContainText(
			/次の試合まで あと \d+ 秒|まもなく次の試合/,
		);
		// 結果の画面には替わらない（観戦の画面のまま）。
		await expect(a.page.getByTestId("result-screen")).toHaveCount(0);

		// 次の試合が始まり、選んだ相手を追い続ける。
		const started = a.link.received("game-started").length;
		await expect
			.poll(() => a.link.received("game-started").length, { timeout: 30_000 })
			.toBeGreaterThan(started);
		await expect(view).toHaveAttribute("data-phase", "preparation", {
			timeout: 30_000,
		});
		await expect(view).toHaveAttribute("data-follow-target", chosen as string);
		await expect
			.poll(() => visibleActors(a), { timeout: 30_000 })
			.toBeGreaterThanOrEqual(3);
	} finally {
		leave(bot);
	}
});

test("観戦ルームを作るトグルは、運営の画面（?operator=1）だけに出て、そこから観戦ルームを作れる @spectate", async ({
	openTab,
}) => {
	const a = await openTab();
	await a.page.goto("/lobby/veryare");
	await expect(a.page.getByTestId("lobby-create-room")).toBeVisible();
	await expect(a.page.getByTestId("lobby-spectate-toggle")).toHaveCount(0);

	await a.page.goto("/lobby/veryare?operator=1");
	const toggle = a.page.getByTestId("lobby-spectate-toggle");
	await expect(toggle).toBeVisible();
	await toggle.check();
	// 観戦ルームの設定（隠れ CPU の数・探索の時間）に替わる。ステージと CPU（対戦の）は出さない。
	await a.page.getByTestId("lobby-spectate-option-hiderCpus").selectOption("2");
	await expect(
		a.page.getByTestId("lobby-spectate-option-explorationSeconds"),
	).toHaveValue("100");
	await expect(a.page.getByTestId("lobby-option-cpu")).toHaveCount(0);

	// 前のテストの観戦ルームが閉じる（0 人で 15 秒）まで、作り直す。
	const view = a.page.getByTestId("veryare-spectate");
	const deadline = Date.now() + IDLE_CLOSE_MS + 15_000;
	while (!(await view.isVisible())) {
		if (Date.now() > deadline) throw new Error("観戦の枠が空かない");
		await a.page.getByTestId("lobby-create-room").click();
		await expect(view.or(a.page.getByTestId("lobby-notice"))).toBeVisible({
			timeout: 10_000,
		});
		if (!(await view.isVisible())) await a.page.waitForTimeout(2_000);
	}
	await expect(view).toHaveAttribute("data-spectating", "true");
	// 隠れ CPU 2 体と鬼 CPU（追う相手は 3 つ）。
	await expect(a.page.getByTestId("spectate-follow")).toHaveCount(3);
	const sent = a.link.sent("create-room").at(-1)?.message;
	expect(sent?.settings).toEqual({
		spectate: 1,
		hiderCpus: 2,
		explorationSeconds: 100,
	});
});

test("iPhone の縦画面で、観戦の画面がスクロールなしで収まる @spectate @layout", async ({
	openTab,
}) => {
	const bot = await Bot.connect(
		SERVER_URL,
		"spectate-layout",
		(url) => new WebSocket(url),
	);
	try {
		const roomId = await createSpectateRoom(bot);
		const a = await openTab();
		await watchFromLobby(a, roomId);
		const view = a.page.getByTestId("veryare-spectate");
		await expect
			.poll(() => visibleActors(a), { timeout: 30_000 })
			.toBeGreaterThanOrEqual(3);
		for (const size of LAYOUT_SIZES) {
			await a.page.setViewportSize({ width: size.width, height: size.height });
			await checkLayout(
				a.page,
				test.info(),
				size,
				`観戦（${await view.getAttribute("data-phase")}）`,
			);
		}
	} finally {
		leave(bot);
	}
});
