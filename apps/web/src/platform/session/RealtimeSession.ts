/**
 * タブに1つの、リアルタイム接続とルームのセッション（issue-40）。
 *
 * ロビーとゲーム画面は、同じ接続（単一接続の多重化 / ADR 0007）と同じルームの状態を
 * 使う。以前は画面ごとに接続を作っていたため、ロビーで参加したルームをゲーム画面へ
 * 持ち込めなかった。ここで接続を1本持ち、ルームの状態（session.ts の reduceSession）と、
 * 画面が開く前に届いた状態のため置き（ReplayBuffer）を、画面の切り替えをまたいで保つ。
 *
 * 副作用: send はサーバーへの送信（参加・作成・退出）。hold の解放は、少し待ってから
 * 退出を送る（ゲーム画面を離れたままにしたとき、ルームに残り続けないため）。
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
} from "./session";

export interface RealtimeSessionOptions {
	/** リロード前のルームへ復帰を頼んでいるなら、そのゲームの種類。 */
	readonly resumeGameType?: GameType | null;
	/** ゲーム画面が離れてから退出するまでの待ち（ミリ秒）。 */
	readonly releaseDelayMs?: number;
}

/** StrictMode の付け外しや、画面の切り替えの一瞬では退出しない程度の待ち。 */
const DEFAULT_RELEASE_DELAY_MS = 300;

export class RealtimeSession {
	private current: SessionState;
	private readonly listeners = new Set<() => void>();
	private readonly buffer = new ReplayBuffer();
	private readonly releaseDelayMs: number;
	private holders = 0;
	private releaseTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly adapter: RealtimeAdapter,
		options: RealtimeSessionOptions = {},
	) {
		this.releaseDelayMs = options.releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS;
		this.current =
			options.resumeGameType == null
				? INITIAL_SESSION
				: reduceSession(INITIAL_SESSION, {
						type: "request",
						kind: "resume",
						gameType: options.resumeGameType,
					});
		adapter.subscribe((message) => {
			this.buffer.record(message);
			this.apply({ type: "server", message });
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
		this.adapter.send(message);
	}

	/** ルームを作る。このゲームの作成・参加を待っている間は、重ねて送らない。 */
	create(
		gameType: GameType,
		settings?: Readonly<Record<string, number>>,
	): void {
		if (this.current.pending?.gameType === gameType) return;
		this.apply({ type: "request", kind: "create", gameType });
		this.adapter.send(
			settings === undefined
				? { type: "create-room", gameType }
				: { type: "create-room", gameType, settings },
		);
	}

	join(gameType: GameType, roomId: RoomId): void {
		this.apply({ type: "request", kind: "join", gameType });
		this.adapter.send({ type: "join-room", gameType, roomId });
	}

	/** 参加中のルームから出る。退出でルームは解散へ向かう（ADR 0017）。 */
	leave(): void {
		this.cancelRelease();
		const room = this.current.room;
		if (room !== null) {
			this.adapter.send({ type: "leave-room", roomId: room.roomId });
		}
		this.buffer.reset();
		this.apply({ type: "left" });
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
