import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type SocketLike } from "./client.ts";

type Listener = (event: { readonly data?: unknown }) => void;

class FakeSocket implements SocketLike {
	readonly sent: ClientMessage[] = [];
	private readonly listeners: Record<string, Listener[]> = {};
	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners[type] ?? [];
		list.push(listener);
		this.listeners[type] = list;
	}
	send(data: string): void {
		this.sent.push(JSON.parse(data) as ClientMessage);
	}
	close(): void {
		this.emit("close", {});
	}
	emit(type: string, event: { readonly data?: unknown }): void {
		for (const listener of this.listeners[type] ?? []) listener(event);
	}
	deliver(message: ServerMessage | string): void {
		this.emit("message", {
			data: typeof message === "string" ? message : JSON.stringify(message),
		});
	}
}

/** つないで session まで済ませたボット。 */
async function connected(): Promise<{ bot: Bot; socket: FakeSocket }> {
	const socket = new FakeSocket();
	const pending = Bot.connect("ws://test/ws", "bot-a", () => socket, 1000);
	socket.emit("open", {});
	socket.deliver({ type: "session", playerId: "p-1", resumeToken: "t" });
	return { bot: await pending, socket };
}

describe("Bot - 契約の電文だけで話すクライアント", () => {
	it("session でプレイヤー識別子を受け取り、表示名を設定する", async () => {
		const { bot, socket } = await connected();
		expect(bot.playerId).toBe("p-1");
		expect(socket.sent).toEqual([
			{ type: "set-name", playerId: "p-1", name: "bot-a" },
		]);
	});

	it("ping には pong を返す（issue-41）", async () => {
		const { socket } = await connected();
		socket.deliver({ type: "ping" });
		expect(socket.sent.at(-1)).toEqual({ type: "pong" });
	});

	it("形の違う電文は捨てる（境界での検証）", async () => {
		const { bot, socket } = await connected();
		const before = bot.received.length;
		socket.deliver("not json");
		socket.deliver(JSON.stringify({ kind: "x" }));
		socket.deliver(JSON.stringify(null));
		expect(bot.received).toHaveLength(before);
	});

	it("待っている電文が届いたら返す。すでに届いていれば、すぐに返す", async () => {
		const { bot, socket } = await connected();
		const waiting = bot.waitFor((m) => m.type === "error", 1000, "error");
		socket.deliver({ type: "error", code: "x", message: "m" });
		await expect(waiting).resolves.toMatchObject({ type: "error" });
		await expect(
			bot.waitFor((m) => m.type === "session", 10, "session"),
		).resolves.toMatchObject({ type: "session" });
	});

	it("閉じた後は送らない", async () => {
		const { bot, socket } = await connected();
		bot.close();
		bot.send({ type: "list-rooms", gameType: "veryare" });
		expect(socket.sent.map((m) => m.type)).toEqual(["set-name"]);
	});
});

describe("Bot - 待ちの上限", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("上限までに届かなければ、何を待っていたかを添えて失敗する", async () => {
		const socket = new FakeSocket();
		const pending = Bot.connect("ws://test/ws", "bot-a", () => socket, 1000);
		socket.emit("open", {});
		const assertion = expect(pending).rejects.toThrow(
			"bot-a: session が 1000ms 届かない",
		);
		await vi.advanceTimersByTimeAsync(1000);
		await assertion;
	});
});
