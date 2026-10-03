import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SocketLike, WebSocketAdapter } from "./WebSocketAdapter";

/** テスト用の偽のソケット。開く・届く・閉じるを手で起こす。 */
class FakeSocket implements SocketLike {
	readonly sent: ClientMessage[] = [];
	closedByClient = false;
	private readonly listeners: Record<
		string,
		((event: { readonly data?: unknown }) => void)[]
	> = {};

	addEventListener(
		type: string,
		listener: (event: { readonly data?: unknown }) => void,
	): void {
		const list = this.listeners[type] ?? [];
		list.push(listener);
		this.listeners[type] = list;
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data) as ClientMessage);
	}

	close(): void {
		this.closedByClient = true;
		this.emit("close", {});
	}

	open(): void {
		this.emit("open", {});
	}

	deliver(message: ServerMessage): void {
		this.emit("message", { data: JSON.stringify(message) });
	}

	/** サーバー側や回線の都合で切れた。 */
	drop(): void {
		this.emit("close", {});
	}

	private emit(type: string, event: { readonly data?: unknown }): void {
		for (const listener of this.listeners[type] ?? []) listener(event);
	}
}

const session = (playerId: string, resumeToken: string): ServerMessage => ({
	type: "session",
	playerId,
	resumeToken,
});

const joined = (roomId: string, you: string): ServerMessage => ({
	type: "room-joined",
	gameType: "veryare",
	roomId,
	you,
	players: [{ playerId: you, name: "user1" }],
});

describe("WebSocketAdapter - 実接続と再接続（issue-31）", () => {
	let sockets: FakeSocket[];
	let adapter: WebSocketAdapter;

	beforeEach(() => {
		vi.useFakeTimers();
		sockets = [];
		adapter = new WebSocketAdapter("ws://test/ws", {
			createSocket: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
			retryDelayMs: 1000,
			maxAttempts: 3,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const current = () => sockets.at(-1) as FakeSocket;

	/** 接続して session を受け取り、ルームに入った状態にする。 */
	function inRoom(roomId = "room-1") {
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined(roomId, "p-1"));
	}

	it("session を受け取って保持し、購読者にも配る", () => {
		const received: ServerMessage[] = [];
		adapter.subscribe((m) => received.push(m));
		current().open();
		current().deliver(session("p-1", "token-1"));
		expect(adapter.session).toEqual({
			playerId: "p-1",
			resumeToken: "token-1",
		});
		expect(received.map((m) => m.type)).toEqual(["session"]);
	});

	it("接続前に送った電文は、つながってから送る", () => {
		adapter.send({ type: "list-rooms", gameType: "veryare" });
		expect(current().sent).toEqual([]);
		current().open();
		expect(current().sent).toEqual([
			{ type: "list-rooms", gameType: "veryare" },
		]);
	});

	it("ルームにいる間に切れたら、つなぎ直して resumeToken で復帰を頼む", () => {
		inRoom();
		current().drop();
		expect(sockets).toHaveLength(1);

		vi.advanceTimersByTime(1000);
		expect(sockets).toHaveLength(2);
		current().open();
		// 新しい接続でも session（新しい値）が先に届くが、復帰には前のトークンを使う。
		current().deliver(session("p-new", "token-new"));
		expect(current().sent[0]).toEqual({
			type: "reconnect",
			roomId: "room-1",
			resumeToken: "token-1",
		});
	});

	it("切れている間に送った電文は、復帰を頼んだ後に送る", () => {
		inRoom();
		current().drop();
		adapter.send({
			type: "game-event",
			gameType: "veryare",
			roomId: "room-1",
			payload: { type: "move", x: 0, z: 0 },
		});
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent.map((m) => m.type)).toEqual([
			"reconnect",
			"game-event",
		]);
	});

	it("復帰に成功すると、元の session が届き、そのまま使い続ける", () => {
		inRoom();
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		current().deliver(session("p-new", "token-new"));
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		expect(adapter.session).toEqual({
			playerId: "p-1",
			resumeToken: "token-1",
		});

		// もう一度切れても、同じトークンで復帰を頼む。
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent[0]).toMatchObject({
			type: "reconnect",
			resumeToken: "token-1",
		});
	});

	it("復帰に失敗したら、ルームを忘れ、次に切れても復帰を頼まない", () => {
		inRoom();
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		current().deliver(session("p-new", "token-new"));
		current().deliver({
			type: "error",
			code: "reconnect-failed",
			message: "前の接続に戻れませんでした。",
		});

		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent).toEqual([]);
	});

	it("ルームにいない間に切れたら、つなぎ直すだけで復帰は頼まない", () => {
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent).toEqual([]);
	});

	it("退出したルームには復帰しない", () => {
		inRoom();
		adapter.send({ type: "leave-room", roomId: "room-1" });
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent).toEqual([]);
	});

	it("自分で閉じたときは、つなぎ直さない", () => {
		inRoom();
		adapter.close();
		vi.advanceTimersByTime(10_000);
		expect(sockets).toHaveLength(1);
	});

	it("つなぎ直しは上限回数で止まる（つながれば数え直す）", () => {
		inRoom();
		current().drop();
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(1000);
			current().drop();
		}
		// 最初の1本 + 上限3回まで。
		expect(sockets).toHaveLength(4);
	});
});
