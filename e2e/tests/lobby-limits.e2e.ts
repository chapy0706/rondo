/**
 * 満員のときの表示（issue-60）。ルームを埋めるのは、ブラウザではなく、ボットの接続（@rondo/bots の
 * クライアント。同じサーバーへ、ふつうの電文でつなぐ）で行い、ブラウザのロビーの表示を確かめる。
 *
 * - ルームが 3 つある（同時ルーム数の上限 / ADR 0030）とき、4 つ目を作ろうとすると、案内の枠
 *   （data-code="room-limit"）と、ひとり用のゲームの一覧が出る
 * - 5 人のルームは、一覧で「満員」（押せない）。1 人抜けると、自動更新（5 秒）で押せる形に戻る
 *
 * 終わったら、ボットはルームを出て閉じる（次のテストに、ルームを残さない）。
 */

import { expect } from "@playwright/test";
import { Bot } from "@rondo/bots/client";
import { test } from "./flows";

const SERVER_URL = "ws://localhost:3000/ws";

/** サーバーからの電文（ボットのクライアントの型から取る。E2E は契約に直接依らない）。 */
type ServerMessage = Awaited<ReturnType<Bot["waitFor"]>>;

async function connect(name: string): Promise<Bot> {
	return Bot.connect(SERVER_URL, name, (url) => new WebSocket(url));
}

/** room-joined か error を待つ（since 番目より後の電文）。 */
function reply(bot: Bot, since: number): Promise<ServerMessage> {
	return bot.waitFor(
		(m) =>
			(m.type === "room-joined" || m.type === "error") &&
			bot.received.findIndex((r) => r.message === m) >= since,
		5_000,
		"room-joined か error",
	);
}

async function create(bot: Bot, roomName?: string): Promise<ServerMessage> {
	const since = bot.received.length;
	bot.send(
		roomName === undefined
			? { type: "create-room", gameType: "veryare" }
			: { type: "create-room", gameType: "veryare", roomName },
	);
	return reply(bot, since);
}

async function join(bot: Bot, roomId: string): Promise<ServerMessage> {
	const since = bot.received.length;
	bot.send({ type: "join-room", gameType: "veryare", roomId });
	return reply(bot, since);
}

function leaveAll(bots: readonly Bot[]): void {
	for (const bot of bots) {
		for (const joined of bot.all("room-joined")) {
			bot.send({ type: "leave-room", roomId: joined.roomId });
		}
		bot.close();
	}
}

test("ルームが 3 つあるとき、4 つ目を作ろうとすると、案内と、ひとり用のゲームの一覧が出る", async ({
	openTab,
}) => {
	const bots: Bot[] = [];
	try {
		// 上限に達するまで、ボットでルームを作る（前のテストのルームが残っていても、上限で止まる）。
		for (let i = 0; i < 3; i++) {
			const bot = await connect(`limit-${i}`);
			bots.push(bot);
			const made = await create(bot);
			if (made.type === "error") {
				expect(made.code).toBe("room-limit");
				break;
			}
		}
		const a = await openTab();
		await a.page.goto("/lobby/veryare");
		await a.page.getByTestId("lobby-create-room").click();
		const notice = a.page.getByTestId("lobby-notice");
		await expect(notice).toHaveAttribute("data-code", "room-limit");
		await expect(notice).toContainText("ルームがいっぱいです");
		const solo = a.page.getByTestId("lobby-solo-games");
		await expect(solo).toBeVisible();
		await expect(solo.locator('a[data-game="tetris"]')).toHaveAttribute(
			"href",
			"/play/tetris",
		);
		await expect(solo.locator('a[href="/select"]')).toBeVisible();
	} finally {
		leaveAll(bots);
	}
});

test("5 人のルームは「満員」で押せず、1 人抜けると、自動更新で押せる形に戻る", async ({
	openTab,
}) => {
	const bots: Bot[] = [];
	try {
		const owner = await connect("full-owner");
		bots.push(owner);
		const made = await create(owner, "満員の試験");
		if (made.type !== "room-joined") throw new Error("ルームを作れない");
		const roomId = made.roomId;
		const name = made.roomName ?? "満員の試験";
		for (let i = 1; i < 5; i++) {
			const bot = await connect(`full-${i}`);
			bots.push(bot);
			const joined = await join(bot, roomId);
			expect(joined.type).toBe("room-joined");
		}

		const a = await openTab();
		await a.page.goto("/lobby/veryare");
		const row = a.page
			.getByTestId("lobby-room")
			.and(a.page.locator(`[data-room-name=${JSON.stringify(name)}]`));
		await expect(row).toHaveAttribute("data-availability", "full");
		await expect(row).toBeDisabled();
		await expect(row).toContainText("満員");

		// 1 人抜けると、自動更新（5 秒ごと）で、押せる形に戻る（待つのは 15 秒まで）。
		const last = bots.pop() as Bot;
		last.send({ type: "leave-room", roomId });
		last.close();
		await expect(row).toHaveAttribute("data-availability", "open");
		await expect(row).toBeEnabled();
	} finally {
		leaveAll(bots);
	}
});
