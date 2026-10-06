/**
 * タブに1つの、リアルタイム接続とルームのセッション（issue-40）。
 *
 * ロビーとゲーム画面は、同じ接続（単一接続の多重化 / ADR 0007）と同じルームの状態を
 * 使う。以前は画面ごとに接続を作っていたため、ロビーで参加したルームをゲーム画面へ
 * 持ち込めなかった。ここで接続を1本持ち、ルームの状態（session.ts の reduceSession）と、
 * 画面が開く前に届いた状態のため置き（ReplayBuffer）を、画面の切り替えをまたいで保つ。
 *
 * 接続まわりの仕上げ（issue-47）:
 * - 参加・作成・復帰の返事が時間内に届かなければ、失敗（timeout）にする
 * - つなぎ直しをすべて失敗したら、失敗（connection-lost）にする。次に頼むときに接続をやり直す
 * - 返事を待つ画面（ゲーム画面の hold、ロビーの watch）がないときに届いた room-joined では、
 *   すぐに退出する（返事の前に画面を離れても、ルームの枠を塞がない）。画面の付け外しの
 *   タイミングに頼らず、room-joined が届いた時点の画面の有無で決める
 *
 * 副作用: サーバーへの送信（参加・作成・退出）。hold の解放は、少し待ってから退出を送る
 * （ゲーム画面を離れたままにしたとき、ルームに残り続けないため）。
 */

import type {
	ClientMessage,
	GameType,
	RealTimePort,
	RoomId,
	ServerMessage,
} from "@rondo/contracts";
import type { RealtimeAdapter } from "../../infrastructure/realtime";
import {
	INITIAL_SESSION,
	ReplayBuffer,
	type SessionEvent,
	type SessionState,
	reduceSession,
	roomJoinedAction,
} from "./session";

export interface RealtimeSessionOptions {
	/** リロード前のルームへ復帰を頼んでいるなら、そのゲームの種類。 */
	readonly resumeGameType?: GameType | null;
	/** ゲーム画面が離れてから退出するまでの待ち（ミリ秒）。 */
	readonly releaseDelayMs?: number;
	/** 参加・作成・復帰の返事を待つ時間（ミリ秒）。 */
	readonly requestTimeoutMs?: number;
}

/** StrictMode の付け外しや、画面の切り替えの一瞬では退出しない程度の待ち。 */
const DEFAULT_RELEASE_DELAY_MS = 300;

/** 返事を待つ時間。つなぎ直し（1秒 × 8回）より長く、待たせすぎない程度。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class RealtimeSession {
	private current: SessionState;
	private readonly listeners = new Set<() => void>();
	private readonly buffer = new ReplayBuffer();
	private readonly releaseDelayMs: number;
	private readonly requestTimeoutMs: number;
	/** ルームを使っているゲーム画面の数。 */
	private holders = 0;
	/** 参加・作成の返事を待っているロビーの数。離れても退出はしない。 */
	private watchers = 0;
	private releaseTimer: ReturnType<typeof setTimeout> | null = null;
	private requestTimer: ReturnType<typeof setTimeout> | null = null;
	/** つなぎ直しをあきらめた後か。次に送るときに接続をやり直す。 */
	private connectionLost = false;

	constructor(
		private readonly adapter: RealtimeAdapter,
		options: RealtimeSessionOptions = {},
	) {
		this.releaseDelayMs = options.releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS;
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.current = INITIAL_SESSION;
		if (options.resumeGameType != null) {
			this.request("resume", options.resumeGameType);
		}
		adapter.subscribe((message) => this.receive(message));
		adapter.onConnectionFailed(() => {
			this.connectionLost = true;
			this.clearRequestTimer();
			this.buffer.reset();
			this.apply({ type: "connection-lost" });
		});
	}

	get state(): SessionState {
		return this.current;
	}

	/** 状態が変わったら呼ばれる（useSyncExternalStore 用）。 */
	subscribeState(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 接続の受信をそのまま購読する（ロビーの一覧など）。 */
	subscribe(handler: (message: ServerMessage) => void): () => void {
		return this.adapter.subscribe(handler);
	}

	send(message: ClientMessage): void {
		this.ensureConnected();
		this.adapter.send(message);
	}

	/** ルームを作る。このゲームの作成・参加を待っている間は、重ねて送らない。 */
	create(
		gameType: GameType,
		settings?: Readonly<Record<string, number>>,
	): void {
		if (this.current.pending?.gameType === gameType) return;
		this.request("create", gameType);
		this.send(
			settings === undefined
				? { type: "create-room", gameType }
				: { type: "create-room", gameType, settings },
		);
	}

	join(gameType: GameType, roomId: RoomId): void {
		this.request("join", gameType);
		this.send({ type: "join-room", gameType, roomId });
	}

	/** 参加中のルームから出る。退出でルームは解散へ向かう（ADR 0017）。 */
	leave(): void {
		this.cancelRelease();
		this.clearRequestTimer();
		const room = this.current.room;
		if (room !== null) {
			this.adapter.send({ type: "leave-room", roomId: room.roomId });
		}
		this.buffer.reset();
		this.apply({ type: "left" });
	}

	/** 失敗とエラーの表示を消す（「もう一度」の前など）。 */
	dismiss(): void {
		this.apply({ type: "dismiss" });
	}

	/**
	 * ゲーム画面がルームを使っている間、握っておく。返す関数で離す。誰も握っていない
	 * 状態が少し続いたら退出する（ブラウザの戻るなどで、ゲーム画面を離れたとき）。
	 * リロードやタブを閉じたときは、ここを通らずに接続が切れ、再接続の猶予に入る（ADR 0013）。
	 */
	hold(): () => void {
		this.holders += 1;
		this.cancelRelease();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.holders -= 1;
			if (this.holders > 0) return;
			this.releaseTimer = setTimeout(() => {
				this.releaseTimer = null;
				if (this.holders === 0) this.leave();
			}, this.releaseDelayMs);
		};
	}

	/**
	 * ロビーが、参加・作成の返事を待っている間、見ておく。返す関数で離す。離しても退出は
	 * しない（ゲーム画面へ移る途中のため）。返事の前に離れていれば、届いた時点で退出する。
	 */
	watch(): () => void {
		this.watchers += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.watchers -= 1;
		};
	}

	/**
	 * ゲームに渡す口。購読すると、画面が開く前に届いたこのルームの状態を先に渡し、
	 * その後は接続の受信をそのまま渡す。
	 */
	gamePort(roomId: RoomId): RealTimePort {
		return {
			send: (message) => this.adapter.send(message),
			subscribe: (handler) => {
				let active = true;
				const unsubscribe = this.adapter.subscribe(handler);
				this.buffer.replayTo(roomId, handler, () => active);
				return () => {
					active = false;
					unsubscribe();
				};
			},
		};
	}

	private receive(message: ServerMessage): void {
		this.buffer.record(message);
		if (message.type === "room-joined") {
			this.clearRequestTimer();
			const hasScreen = this.holders + this.watchers > 0;
			if (
				roomJoinedAction(this.current, message.roomId, hasScreen) === "leave"
			) {
				// 待つ画面がない、または別のルームにいる。届いたルームから、すぐに出る。
				this.adapter.send({ type: "leave-room", roomId: message.roomId });
				this.buffer.drop(message.roomId);
				if (this.current.room === null) this.apply({ type: "left" });
				return;
			}
		}
		if (message.type === "error") this.clearRequestTimer();
		this.apply({ type: "server", message });
	}

	/** 頼みごとを記録し、返事を待つ時間を計り始める。 */
	private request(
		kind: "create" | "join" | "resume",
		gameType: GameType,
	): void {
		this.apply({ type: "request", kind, gameType });
		this.clearRequestTimer();
		this.requestTimer = setTimeout(() => {
			this.requestTimer = null;
			this.apply({ type: "timeout" });
		}, this.requestTimeoutMs);
	}

	/** つなぎ直しをあきらめた後なら、送る前に接続をやり直す。 */
	private ensureConnected(): void {
		if (!this.connectionLost) return;
		this.connectionLost = false;
		this.adapter.reconnect();
	}

	private clearRequestTimer(): void {
		if (this.requestTimer !== null) {
			clearTimeout(this.requestTimer);
			this.requestTimer = null;
		}
	}

	private cancelRelease(): void {
		if (this.releaseTimer !== null) {
			clearTimeout(this.releaseTimer);
			this.releaseTimer = null;
		}
	}

	private apply(event: SessionEvent): void {
		const next = reduceSession(this.current, event);
		if (next === this.current) return;
		this.current = next;
		for (const listener of [...this.listeners]) listener();
	}
}
