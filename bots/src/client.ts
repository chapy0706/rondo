/**
 * ボットのクライアント（issue-49）。画面も three.js も使わず、契約（@rondo/contracts）の
 * 電文だけで Gleam サーバーと話す。
 *
 * - 接続直後の session でプレイヤー識別子を受け取る
 * - ping（issue-41）には pong を返す
 * - 届いた電文を時刻つきで記録し、条件に合う電文を待てる（シナリオの進行と検査に使う）
 *
 * 受け取った値は unknown として、type が文字列のオブジェクトだけを通す（境界での検証）。
 * 中身の検査は、使うところ（expect.ts）で行う。
 */

import type { ClientMessage, ServerMessage } from "@rondo/contracts";

/** ボットが使うソケットの最小形（Node の WebSocket と、テスト用の偽物）。 */
export interface SocketLike {
	send(data: string | Uint8Array): void;
	close(): void;
	addEventListener(
		type: "open" | "message" | "close" | "error",
		listener: (event: { readonly data?: unknown }) => void,
	): void;
}

export type CreateSocket = (url: string) => SocketLike;

/** 記録した電文。 */
export interface Received {
	readonly at: number;
	readonly message: ServerMessage;
}

interface Waiter {
	readonly test: (message: ServerMessage) => boolean;
	readonly resolve: (message: ServerMessage) => void;
}

export class Bot {
	readonly received: Received[] = [];
	playerId: string | null = null;
	/** session で届いた復帰トークン（再接続の試験に使う / issue-51）。 */
	resumeToken: string | null = null;
	/** 受け取った電文のバイト数（UTF-8。通信量の測定に使う / issue-51）。 */
	bytesReceived = 0;
	private readonly waiters = new Set<Waiter>();
	private readonly listeners = new Set<(message: ServerMessage) => void>();
	private closed = false;
	readonly name: string;
	private readonly socket: SocketLike;

	private constructor(name: string, socket: SocketLike) {
		this.name = name;
		this.socket = socket;
		socket.addEventListener("message", (event) => this.receive(event.data));
		socket.addEventListener("close", () => {
			this.closed = true;
		});
	}

	/** つないで、session（プレイヤー識別子）が届くまで待つ。 */
	static async connect(
		url: string,
		name: string,
		createSocket: CreateSocket,
		timeoutMs = 5_000,
	): Promise<Bot> {
		const bot = await Bot.open(url, name, createSocket, timeoutMs);
		bot.send({ type: "set-name", playerId: bot.playerId ?? "", name });
		return bot;
	}

	/**
	 * 新しい接続で、前の接続のルームへ復帰を頼む（issue-51 の乱れた通信の試験）。session を受けてから
	 * reconnect を送る。名前は送らない（復帰すれば、前の名前のまま）。返事（room-joined か error）は
	 * 呼び出し側が待つ。
	 */
	static async reconnect(
		url: string,
		name: string,
		createSocket: CreateSocket,
		roomId: string,
		resumeToken: string,
		timeoutMs = 5_000,
	): Promise<Bot> {
		const bot = await Bot.open(url, name, createSocket, timeoutMs);
		bot.send({ type: "reconnect", roomId, resumeToken });
		return bot;
	}

	private static async open(
		url: string,
		name: string,
		createSocket: CreateSocket,
		timeoutMs: number,
	): Promise<Bot> {
		const socket = createSocket(url);
		const bot = new Bot(name, socket);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve());
			socket.addEventListener("error", () =>
				reject(new Error(`${name}: ${url} につながらない`)),
			);
		});
		await bot.waitFor((m) => m.type === "session", timeoutMs, "session");
		return bot;
	}

	get isClosed(): boolean {
		return this.closed;
	}

	send(message: ClientMessage): void {
		if (this.closed) return;
		this.socket.send(JSON.stringify(message));
	}

	/** 生の電文を、そのまま送る（壊れた JSON・バイナリの試験 / issue-51）。 */
	sendRaw(data: string | Uint8Array): void {
		if (this.closed) return;
		this.socket.send(data);
	}

	/** 届いた電文を、届くたびに受け取る（シナリオの手順の引き金に使う）。 */
	onMessage(listener: (message: ServerMessage) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * 条件に合う電文を待つ。すでに届いていれば、それを返す。
	 * timeoutMs のうちに届かなければ、label を添えて失敗する。
	 */
	waitFor(
		test: (message: ServerMessage) => boolean,
		timeoutMs: number,
		label: string,
	): Promise<ServerMessage> {
		const found = this.received.find((r) => test(r.message));
		if (found !== undefined) return Promise.resolve(found.message);
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				test,
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
			};
			const timer = setTimeout(() => {
				this.waiters.delete(waiter);
				reject(new Error(`${this.name}: ${label} が ${timeoutMs}ms 届かない`));
			}, timeoutMs);
			this.waiters.add(waiter);
		});
	}

	/** 受け取った電文のうち、type が一致するもの。 */
	all<T extends ServerMessage["type"]>(
		type: T,
	): Extract<ServerMessage, { type: T }>[] {
		return this.received
			.map((r) => r.message)
			.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
	}

	close(): void {
		this.closed = true;
		this.socket.close();
	}

	private receive(data: unknown): void {
		if (typeof data === "string") {
			this.bytesReceived += encoder.encode(data).length;
		}
		const message = toServerMessage(data);
		if (message === null) return;
		if (message.type === "ping") {
			// ハートビート（issue-41）。記録はするが、応答だけして先へは渡さない。
			this.send({ type: "pong" });
		}
		if (message.type === "session") {
			this.playerId = message.playerId;
			this.resumeToken = message.resumeToken;
		}
		this.received.push({ at: Date.now(), message });
		for (const waiter of [...this.waiters]) {
			if (waiter.test(message)) {
				this.waiters.delete(waiter);
				waiter.resolve(message);
			}
		}
		for (const listener of [...this.listeners]) listener(message);
	}
}

const encoder = new TextEncoder();

/** テキストの電文を、type が文字列のオブジェクトとしてだけ通す。 */
function toServerMessage(data: unknown): ServerMessage | null {
	if (typeof data !== "string") return null;
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	if (typeof (value as { type?: unknown }).type !== "string") return null;
	return value as ServerMessage;
}
