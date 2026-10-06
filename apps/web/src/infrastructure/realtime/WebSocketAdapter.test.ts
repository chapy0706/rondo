import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SocketLike, WebSocketAdapter } from "./WebSocketAdapter";
import type { ResumeStore, ResumeTarget } from "./resumeStore";

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

/** 覚えた値をそのまま持つ、テスト用の復帰先の置き場。 */
function memoryResumeStore(initial: ResumeTarget | null = null) {
	let value = initial;
	const store: ResumeStore = {
		load: () => value,
		save: (target) => {
			value = target;
		},
		clear: () => {
			value = null;
		},
	};
	return { store, current: () => value };
}

describe("WebSocketAdapter - リロードをまたぐ復帰（issue-40）", () => {
	let sockets: FakeSocket[];

	beforeEach(() => {
		vi.useFakeTimers();
		sockets = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function create(store: ResumeStore) {
		return new WebSocketAdapter("ws://test/ws", {
			createSocket: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
			retryDelayMs: 1000,
			maxAttempts: 3,
			resumeStore: store,
		});
	}

	const current = () => sockets.at(-1) as FakeSocket;

	it("自分のルームに入ったら、ゲームの種類・ルーム・復帰トークンを覚える", () => {
		const memory = memoryResumeStore();
		create(memory.store);
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		expect(memory.current()).toEqual({
			gameType: "veryare",
			roomId: "room-1",
			resumeToken: "token-1",
		});
	});

	it("覚えた復帰先があれば、最初の接続で、ほかの電文より先に復帰を頼む", () => {
		const memory = memoryResumeStore({
			gameType: "veryare",
			roomId: "room-1",
			resumeToken: "token-1",
		});
		const adapter = create(memory.store);
		adapter.send({ type: "list-rooms", gameType: "veryare" });
		current().open();
		expect(current().sent).toEqual([
			{ type: "reconnect", roomId: "room-1", resumeToken: "token-1" },
			{ type: "list-rooms", gameType: "veryare" },
		]);
	});

	it("復帰に成功したら、その後の切断でも同じルームへ復帰を頼む", () => {
		const memory = memoryResumeStore({
			gameType: "veryare",
			roomId: "room-1",
			resumeToken: "token-1",
		});
		create(memory.store);
		current().open();
		current().deliver(session("p-new", "token-new"));
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent[0]).toEqual({
			type: "reconnect",
			roomId: "room-1",
			resumeToken: "token-1",
		});
	});

	it("退出したら、覚えた復帰先を消す", () => {
		const memory = memoryResumeStore();
		const adapter = create(memory.store);
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		adapter.send({ type: "leave-room", roomId: "room-1" });
		expect(memory.current()).toBeNull();
	});

	it("ゲームが終わったら（game-ended）、覚えた復帰先を消し、切れても復帰を頼まない（issue-42）", () => {
		const memory = memoryResumeStore();
		create(memory.store);
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		current().deliver({
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-1",
			result: { order: "higher-is-better", rankings: [] },
		});
		expect(memory.current()).toBeNull();

		current().drop();
		vi.advanceTimersByTime(1000);
		current().open();
		expect(current().sent).toEqual([]);
	});

	it("ほかのルームの game-ended では、復帰先を消さない", () => {
		const memory = memoryResumeStore();
		create(memory.store);
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		current().deliver({
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-2",
			result: { order: "higher-is-better", rankings: [] },
		});
		expect(memory.current()?.roomId).toBe("room-1");
	});

	it("復帰に失敗したら、覚えた復帰先を消す", () => {
		const memory = memoryResumeStore({
			gameType: "veryare",
			roomId: "room-1",
			resumeToken: "token-1",
		});
		create(memory.store);
		current().open();
		current().deliver({
			type: "error",
			code: "reconnect-failed",
			message: "前の接続に戻れませんでした。",
		});
		expect(memory.current()).toBeNull();
	});
});

describe("WebSocketAdapter - つなぎ直しをあきらめたとき（issue-47）", () => {
	let sockets: FakeSocket[];

	beforeEach(() => {
		vi.useFakeTimers();
		sockets = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const current = () => sockets.at(-1) as FakeSocket;

	function create(store?: ResumeStore) {
		return new WebSocketAdapter("ws://test/ws", {
			createSocket: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
			retryDelayMs: 1000,
			maxAttempts: 2,
			...(store === undefined ? {} : { resumeStore: store }),
		});
	}

	it("上限までつなぎ直してもつながらなければ、1回だけ知らせ、復帰先を消す", () => {
		const memory = memoryResumeStore();
		const adapter = create(memory.store);
		const failed = vi.fn();
		adapter.onConnectionFailed(failed);
		current().open();
		current().deliver(session("p-1", "token-1"));
		current().deliver(joined("room-1", "p-1"));
		current().drop();
		vi.advanceTimersByTime(1000);
		current().drop();
		vi.advanceTimersByTime(1000);
		expect(failed).not.toHaveBeenCalled();
		current().drop();
		expect(failed).toHaveBeenCalledTimes(1);
		expect(memory.current()).toBeNull();
		vi.advanceTimersByTime(10_000);
		expect(failed).toHaveBeenCalledTimes(1);
	});

	it("最初の接続からつながらないときも、上限で知らせる", () => {
		const adapter = create();
		const failed = vi.fn();
		adapter.onConnectionFailed(failed);
		current().drop();
		vi.advanceTimersByTime(1000);
		current().drop();
		vi.advanceTimersByTime(1000);
		current().drop();
		expect(failed).toHaveBeenCalledTimes(1);
	});

	it("あきらめた後に reconnect すると、新しくつなぎ、ためた電文を送る", () => {
		const adapter = create();
		current().drop();
		vi.advanceTimersByTime(1000);
		current().drop();
		vi.advanceTimersByTime(1000);
		current().drop();
		const before = sockets.length;
		adapter.send({ type: "list-rooms", gameType: "veryare" });
		adapter.reconnect();
		expect(sockets).toHaveLength(before + 1);
		current().open();
		expect(current().sent).toEqual([
			{ type: "list-rooms", gameType: "veryare" },
		]);
	});

	it("つながっている間の reconnect は何もしない", () => {
		const adapter = create();
		current().open();
		adapter.reconnect();
		expect(sockets).toHaveLength(1);
	});
});
