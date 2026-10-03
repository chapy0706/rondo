/**
 * Gleam サーバーへの単一 WebSocket 接続を多重化するアダプタ（ADR 0007）。
 *
 * 1 本の接続でロビー・ルーム・ゲーム進行のすべてを運ぶ。送信は JSON テキストで
 * 直列化し、接続確立前（と切断中）の送信は outbox に貯めて、つながってから流す。
 * 受信は境界で検証してから購読者へ配り、型の嘘を通さない（ADR 0009）。
 *
 * 再接続（issue-31 / ADR 0013）: 接続直後にサーバーから届く session（プレイヤー識別子と
 * 復帰トークン）を保持する。ルームにいる間に自分で閉じたのではない切断が起きたら、一定
 * 間隔でつなぎ直し、つながったら最初に、切断時点のルームと復帰トークンで reconnect を
 * 送る。サーバーの再接続猶予（10秒）のうちなら、同じプレイヤーとして同じルームに戻る。
 * 復帰トークンは本人の秘密の値なので、送る先はこのサーバーだけで、ログにも出さない。
 */

import type { ClientMessage, RoomId, ServerMessage } from "@rondo/contracts";
import { MultiplexingAdapter } from "./MultiplexingAdapter";
import { parseServerMessage, safeJsonParse } from "./parse";

/** アダプタが使うソケットの最小形（ブラウザの WebSocket と、テスト用の偽物）。 */
export interface SocketLike {
	send(data: string): void;
	close(): void;
	/** open / close は引数を使わない。message は event.data に受信データが入る。 */
	addEventListener(
		type: "open" | "message" | "close",
		listener: (event: { readonly data?: unknown }) => void,
	): void;
}

export interface WebSocketAdapterOptions {
	/** ソケットの作り方。既定はブラウザの WebSocket。 */
	readonly createSocket?: (url: string) => SocketLike;
	/** つなぎ直す間隔（ミリ秒）。 */
	readonly retryDelayMs?: number;
	/** つなぎ直す回数の上限。つながったら数え直す。 */
	readonly maxAttempts?: number;
}

/** サーバーが発行した、この接続のプレイヤー。 */
export interface SessionInfo {
	readonly playerId: string;
	readonly resumeToken: string;
}

/** 間隔 1 秒 × 8 回で、サーバーの再接続猶予（10 秒）に収める。 */
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_ATTEMPTS = 8;

export class WebSocketAdapter extends MultiplexingAdapter {
	private readonly createSocket: (url: string) => SocketLike;
	private readonly retryDelayMs: number;
	private readonly maxAttempts: number;
	private readonly outbox: ClientMessage[] = [];

	private socket: SocketLike;
	private connected = false;
	private closedByClient = false;
	private attempts = 0;

	/** 最新の session。復帰に成功すると元の値が届き直す。 */
	private current: SessionInfo | null = null;
	/** 参加中のルーム（自分宛ての room-joined で覚え、leave-room で忘れる）。 */
	private room: RoomId | null = null;
	/** 切断時点の復帰先。つながったら最初に reconnect で送る。 */
	private resumeTarget: { roomId: RoomId; resumeToken: string } | null = null;

	constructor(
		private readonly url: string,
		options: WebSocketAdapterOptions = {},
	) {
		super();
		this.createSocket =
			options.createSocket ?? ((target) => new WebSocket(target));
		this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		this.socket = this.connect();
	}

	/** 今のプレイヤー（サーバーが発行したもの）。まだ届いていなければ null。 */
	get session(): SessionInfo | null {
		return this.current;
	}

	send(message: ClientMessage): void {
		if (message.type === "leave-room") {
			// 自分で退出したルームには、切断しても戻らない。
			this.room = null;
			this.resumeTarget = null;
		}
		if (this.connected) {
			this.socket.send(JSON.stringify(message));
		} else {
			this.outbox.push(message);
		}
	}

	close(): void {
		this.closedByClient = true;
		this.socket.close();
	}

	private connect(): SocketLike {
		const socket = this.createSocket(this.url);
		socket.addEventListener("open", () => {
			if (socket !== this.socket) return;
			this.connected = true;
			this.attempts = 0;
			// 復帰を先に頼んでから、切断中にためた電文を流す。
			if (this.resumeTarget !== null) {
				socket.send(
					JSON.stringify({
						type: "reconnect",
						roomId: this.resumeTarget.roomId,
						resumeToken: this.resumeTarget.resumeToken,
					} satisfies ClientMessage),
				);
			}
			this.flush();
		});
		socket.addEventListener("message", (event) => {
			if (socket !== this.socket) return;
			this.receive(event.data);
		});
		socket.addEventListener("close", () => {
			if (socket !== this.socket) return;
			this.connected = false;
			if (this.closedByClient) return;
			this.scheduleReconnect();
		});
		return socket;
	}

	/** 自分で閉じたのではない切断。ルームにいれば復帰先を覚えて、つなぎ直す。 */
	private scheduleReconnect(): void {
		if (this.room !== null && this.current !== null) {
			this.resumeTarget = {
				roomId: this.room,
				resumeToken: this.current.resumeToken,
			};
		}
		if (this.attempts >= this.maxAttempts) return;
		this.attempts += 1;
		setTimeout(() => {
			if (this.closedByClient) return;
			this.socket = this.connect();
		}, this.retryDelayMs);
	}

	private flush(): void {
		for (const message of this.outbox.splice(0)) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private receive(data: unknown): void {
		// rondo はテキストフレームで多重化する。バイナリは想定しないため捨てる。
		if (typeof data !== "string") return;
		const parsed = parseServerMessage(safeJsonParse(data));
		if (parsed === null) return;
		this.track(parsed);
		this.dispatch(parsed);
	}

	/** 再接続に要る状態（session・参加中のルーム・復帰の成否）を追う。 */
	private track(message: ServerMessage): void {
		switch (message.type) {
			case "session":
				this.current = {
					playerId: message.playerId,
					resumeToken: message.resumeToken,
				};
				break;
			case "room-joined":
				if (message.you === this.current?.playerId) {
					this.room = message.roomId;
					this.resumeTarget = null;
				}
				break;
			case "error":
				if (message.code === "reconnect-failed") {
					// 前のプレイヤーには戻れなかった。新しい接続として続ける。
					this.room = null;
					this.resumeTarget = null;
				}
				break;
			default:
				break;
		}
	}
}
