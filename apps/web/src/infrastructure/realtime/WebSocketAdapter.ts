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
 *
 * ハートビート（issue-41 / ADR 0041）: サーバーの ping には pong を返し、購読者には渡さない。
 * つながっている間に、サーバーから何も届かない時間が待ち時間（既定 50 秒）を超えたら、
 * 接続を失ったとみなして古いソケットを見捨て、つなぎ直す（ルームにいれば復帰を頼む）。
 *
 * リロードをまたぐ復帰（issue-40）: resumeStore を渡すと、参加中のルームと復帰トークンを
 * そこへ覚え、次に作られたとき（リロードの後）に、最初の接続で reconnect を送る。
 */

import type { ClientMessage, RoomId, ServerMessage } from "@rondo/contracts";
import { MultiplexingAdapter } from "./MultiplexingAdapter";
import { parseServerMessage, safeJsonParse } from "./parse";
import type { ResumeStore } from "./resumeStore";

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
	/** リロードをまたいで復帰先を覚える置き場。渡さなければ、接続の中だけで覚える。 */
	readonly resumeStore?: ResumeStore;
	/** サーバーから何も届かないとき、接続を失ったとみなすまでの時間（ミリ秒）。 */
	readonly silenceTimeoutMs?: number;
}

/** サーバーが発行した、この接続のプレイヤー。 */
export interface SessionInfo {
	readonly playerId: string;
	readonly resumeToken: string;
}

/** 間隔 1 秒 × 8 回で、サーバーの再接続猶予（10 秒）に収める。 */
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_ATTEMPTS = 8;

/** サーバーの ping の間隔（20 秒）の 2 回分に余裕を足した時間。サーバーの待ち時間と同じ。 */
const DEFAULT_SILENCE_TIMEOUT_MS = 50_000;

export class WebSocketAdapter extends MultiplexingAdapter {
	private readonly createSocket: (url: string) => SocketLike;
	private readonly retryDelayMs: number;
	private readonly maxAttempts: number;
	private readonly outbox: ClientMessage[] = [];
	private readonly resumeStore: ResumeStore | null;
	private readonly silenceTimeoutMs: number;
	/** 無通信の検知のタイマー。届くたびに張り直す。 */
	private silenceTimer: ReturnType<typeof setTimeout> | null = null;

	private socket: SocketLike;
	private connected = false;
	private closedByClient = false;
	private attempts = 0;
	/** つなぎ直しをあきらめたか。reconnect で戻す。 */
	private gaveUp = false;

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
		this.resumeStore = options.resumeStore ?? null;
		this.silenceTimeoutMs =
			options.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
		// リロード前のルームがあれば、最初の接続で復帰を頼む。
		const stored = this.resumeStore?.load() ?? null;
		if (stored !== null) {
			this.resumeTarget = {
				roomId: stored.roomId,
				resumeToken: stored.resumeToken,
			};
		}
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
			this.resumeStore?.clear();
		}
		if (this.connected) {
			this.socket.send(JSON.stringify(message));
		} else {
			this.outbox.push(message);
		}
	}

	close(): void {
		this.closedByClient = true;
		this.clearSilence();
		this.socket.close();
	}

	private connect(): SocketLike {
		const socket = this.createSocket(this.url);
		socket.addEventListener("open", () => {
			if (socket !== this.socket) return;
			this.connected = true;
			this.attempts = 0;
			this.armSilence();
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
			// 何か届けば（ping を含む）、まだつながっている。
			this.armSilence();
			this.receive(event.data);
		});
		socket.addEventListener("close", () => {
			if (socket !== this.socket) return;
			this.connected = false;
			this.clearSilence();
			if (this.closedByClient) return;
			this.scheduleReconnect();
		});
		return socket;
	}

	/** 自分で閉じたのではない切断。ルームにいれば復帰先を覚えて、つなぎ直す。 */
	private scheduleReconnect(): void {
		this.rememberResume();
		if (this.attempts >= this.maxAttempts) {
			this.giveUp();
			return;
		}
		this.attempts += 1;
		setTimeout(() => {
			if (this.closedByClient) return;
			this.socket = this.connect();
		}, this.retryDelayMs);
	}

	/** あきらめた接続を、新しくつなぎ直す（issue-47）。つながっている・つなぎ直し中は何もしない。 */
	override reconnect(): void {
		if (!this.gaveUp || this.closedByClient) return;
		this.gaveUp = false;
		this.attempts = 0;
		this.socket = this.connect();
	}

	/**
	 * つなぎ直しをあきらめる。猶予（ADR 0013）を過ぎているので、元のルームには戻れない。
	 * 復帰先を消し、画面へ知らせる。
	 */
	private giveUp(): void {
		if (this.gaveUp) return;
		this.gaveUp = true;
		this.room = null;
		this.resumeTarget = null;
		this.resumeStore?.clear();
		this.notifyConnectionFailed();
	}

	/** ルームにいれば、切断時点のルームと復帰トークンを、次の接続で使う復帰先にする。 */
	private rememberResume(): void {
		if (this.room !== null && this.current !== null) {
			this.resumeTarget = {
				roomId: this.room,
				resumeToken: this.current.resumeToken,
			};
		}
	}

	/** 無通信の検知を張り直す。待ち時間のあいだ何も届かなければ、接続を見捨てる。 */
	private armSilence(): void {
		this.clearSilence();
		this.silenceTimer = setTimeout(() => {
			this.silenceTimer = null;
			this.abandon();
		}, this.silenceTimeoutMs);
	}

	private clearSilence(): void {
		if (this.silenceTimer !== null) {
			clearTimeout(this.silenceTimer);
			this.silenceTimer = null;
		}
	}

	/**
	 * 応答のない接続を見捨てて、すぐにつなぎ直す（issue-41）。応答のない接続の close は
	 * いつ届くか分からないので待たない。古いソケットのその後の通知は、接続の照合で無視する。
	 */
	private abandon(): void {
		if (this.closedByClient) return;
		const old = this.socket;
		this.connected = false;
		this.rememberResume();
		this.socket = this.connect();
		old.close();
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
		if (parsed.type === "ping") {
			// ハートビートは接続の層で答え、購読者（ゲーム・画面）には渡さない。
			if (this.connected) {
				this.socket.send(
					JSON.stringify({ type: "pong" } satisfies ClientMessage),
				);
			}
			return;
		}
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
					this.resumeStore?.save({
						gameType: message.gameType,
						roomId: message.roomId,
						resumeToken: this.current.resumeToken,
					});
				}
				break;
			case "game-ended":
				if (message.roomId === this.room) {
					// 終わったルームには戻らない（issue-42）。結果は画面が持つ。
					this.room = null;
					this.resumeTarget = null;
					this.resumeStore?.clear();
				}
				break;
			case "error":
				if (message.code === "reconnect-failed") {
					// 前のプレイヤーには戻れなかった。新しい接続として続ける。
					this.room = null;
					this.resumeTarget = null;
					this.resumeStore?.clear();
				}
				break;
			default:
				break;
		}
	}
}
