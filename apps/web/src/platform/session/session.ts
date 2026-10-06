/**
 * 画面（ロビー・ゲーム画面）をまたいで持つ、ルームの状態とその遷移（issue-40）。
 *
 * ロビーで参加したルームを、ゲーム画面がそのまま開けるよう、ルームの状態は画面ではなく
 * タブに1つのセッション（RealtimeSession）が持つ。ここはその判定だけを集めた純粋な
 * 関数で、接続や React には依存しない。ゲームの中身も知らない（gameType で区別するだけ）。
 */

import type {
	GameType,
	PlayerId,
	PlayerInfo,
	RealtimeResult,
	RoomId,
	ServerMessage,
} from "@rondo/contracts";

/** 参加中のルーム。 */
export interface RoomSession {
	readonly gameType: GameType;
	readonly roomId: RoomId;
	readonly you: PlayerId;
	readonly players: readonly PlayerInfo[];
}

/** 返事を待っている頼みごと。resume はリロード後の復帰。 */
export interface PendingRequest {
	readonly kind: "create" | "join" | "resume";
	readonly gameType: GameType;
}

/**
 * つながらなかった理由（issue-47）。画面は理由ごとに文言を変えず、次の操作を示す。
 * - timeout: 参加・作成・復帰の返事が時間内に届かなかった
 * - connection-lost: つなぎ直しをすべて失敗した
 */
export type SessionFailure = "timeout" | "connection-lost";

export interface SessionState {
	readonly room: RoomSession | null;
	readonly pending: PendingRequest | null;
	/** 参加中のルームの確定結果（game-ended）。 */
	readonly result: RealtimeResult | null;
	readonly error: string | null;
	readonly failure: SessionFailure | null;
}

export type SessionEvent =
	| { readonly type: "server"; readonly message: ServerMessage }
	| {
			readonly type: "request";
			readonly kind: PendingRequest["kind"];
			readonly gameType: GameType;
	  }
	| { readonly type: "left" }
	/** 返事を待つ時間が過ぎた。 */
	| { readonly type: "timeout" }
	/** つなぎ直しをすべて失敗した。 */
	| { readonly type: "connection-lost" }
	/** 失敗とエラーの表示を消す。 */
	| { readonly type: "dismiss" };

export const INITIAL_SESSION: SessionState = {
	room: null,
	pending: null,
	result: null,
	error: null,
	failure: null,
};

export function reduceSession(
	state: SessionState,
	event: SessionEvent,
): SessionState {
	switch (event.type) {
		case "request":
			return {
				...state,
				pending: { kind: event.kind, gameType: event.gameType },
				error: null,
				failure: null,
			};
		case "left":
			return INITIAL_SESSION;
		case "timeout":
			if (state.pending === null) return state;
			return { ...state, pending: null, failure: "timeout" };
		case "connection-lost":
			if (state.room === null && state.pending === null) return state;
			return {
				...state,
				room: null,
				pending: null,
				result: null,
				failure: "connection-lost",
			};
		case "dismiss":
			return { ...state, error: null, failure: null };
		case "server":
			return reduceServer(state, event.message);
	}
}

function reduceServer(
	state: SessionState,
	message: ServerMessage,
): SessionState {
	switch (message.type) {
		case "room-joined":
			// 頼んだ参加・作成の返事と、再接続での復帰の両方がここに来る。
			return {
				room: {
					gameType: message.gameType,
					roomId: message.roomId,
					you: message.you,
					players: message.players,
				},
				pending: null,
				result: state.room?.roomId === message.roomId ? state.result : null,
				error: null,
				failure: null,
			};
		case "player-joined": {
			const room = state.room;
			if (room === null || room.roomId !== message.roomId) return state;
			if (room.players.some((p) => p.playerId === message.player.playerId)) {
				return state;
			}
			return {
				...state,
				room: { ...room, players: [...room.players, message.player] },
			};
		}
		case "player-left": {
			const room = state.room;
			if (room === null || room.roomId !== message.roomId) return state;
			return {
				...state,
				room: {
					...room,
					players: room.players.filter((p) => p.playerId !== message.playerId),
				},
			};
		}
		case "game-ended":
			if (state.room?.roomId !== message.roomId) return state;
			return { ...state, result: message.result };
		case "error":
			return {
				...state,
				// 戻れなかったルームは、もう自分のルームではない。
				room: message.code === "reconnect-failed" ? null : state.room,
				pending: null,
				error: message.message,
			};
		default:
			return state;
	}
}

/**
 * 届いた room-joined を受け入れるか、すぐに出るか（取り残しの防止 / issue-47）。
 * 返事を待つ画面（ロビー・ゲーム画面）がなければ出る。返事の前に画面を離れた場合で、
 * 接続は切れていないので再接続の猶予（ADR 0013）も働かず、出なければ枠を塞ぐ。
 * すでに別のルームにいれば、新しく届いたほうから出る（時間切れの後の、遅れた返事など）。
 */
export function roomJoinedAction(
	state: SessionState,
	roomId: RoomId,
	hasScreen: boolean,
): "accept" | "leave" {
	if (!hasScreen) return "leave";
	if (state.room !== null && state.room.roomId !== roomId) return "leave";
	return "accept";
}

/** ゲーム画面に出すもの。joined はゲーム、failed は失敗の表示、connecting は接続中。 */
export function playStatus(
	state: SessionState,
	gameType: GameType,
): "joined" | "failed" | "connecting" {
	if (state.room?.gameType === gameType) return "joined";
	if (state.failure !== null) return "failed";
	return "connecting";
}

/** ロビーが、このゲームの画面へ移るべきか（このゲームのルームに参加中）。 */
export function lobbyShouldEnter(
	state: SessionState,
	gameType: GameType,
): boolean {
	return state.room?.gameType === gameType;
}

/**
 * ゲーム画面を開いたときの入り方。
 * - joined: 参加中のルームをそのまま開く（ロビーから来た、または復帰した）
 * - waiting: 参加・作成・復帰の返事を待つ
 * - create: 新しく作る（選択画面から直接来た）
 * - leave-and-create: ほかのゲームのルームから出てから作る
 */
export type PlayEntry = "joined" | "waiting" | "create" | "leave-and-create";

export function playEntry(state: SessionState, gameType: GameType): PlayEntry {
	if (state.room?.gameType === gameType) return "joined";
	if (state.pending?.gameType === gameType) return "waiting";
	if (state.room !== null) return "leave-and-create";
	return "create";
}

/** ためる通知の上限（既定）。ゲーム画面が開くまでの短い間だけためる前提の安全弁。 */
const DEFAULT_BUFFER_LIMIT = 2000;

type GameStateMessage = Extract<
	ServerMessage,
	{ type: "game-state" | "game-state-to" }
>;

/**
 * ゲーム画面が購読を始める前に届いたゲームの状態（game-state / game-state-to）をためて、
 * 購読した後に渡す。サーバーは参加した直後に今の状態を送る（room-joined より先に届く
 * こともある）が、ロビーからゲーム画面へ移る間は、まだ誰もそれを聞いていないため。
 *
 * 一度渡したルームは、以後ためない（状態はゲーム画面が持つ）。
 */
export class ReplayBuffer {
	private messages: GameStateMessage[] = [];
	private readonly delivered = new Set<RoomId>();

	constructor(private readonly limit = DEFAULT_BUFFER_LIMIT) {}

	get size(): number {
		return this.messages.length;
	}

	record(message: ServerMessage): void {
		if (message.type !== "game-state" && message.type !== "game-state-to") {
			return;
		}
		if (this.delivered.has(message.roomId)) return;
		this.messages.push(message);
		if (this.messages.length > this.limit) {
			this.messages.splice(0, this.messages.length - this.limit);
		}
	}

	/**
	 * ためたうち、このルームの分を handler に渡す。購読と同じ流れで後から登録される
	 * ハンドラ（ゲームの on）に間に合うよう、マイクロタスクで渡す。渡す時点で isActive が
	 * false（購読が解かれた）なら渡さず、次の購読のために残す。
	 */
	replayTo(
		roomId: RoomId,
		handler: (message: ServerMessage) => void,
		isActive: () => boolean,
	): void {
		queueMicrotask(() => {
			if (!isActive() || this.delivered.has(roomId)) return;
			const mine = this.messages.filter((m) => m.roomId === roomId);
			this.messages = this.messages.filter((m) => m.roomId !== roomId);
			this.delivered.add(roomId);
			for (const message of mine) handler(message);
		});
	}

	/** このルームの分を捨てる（出たルーム）。 */
	drop(roomId: RoomId): void {
		this.messages = this.messages.filter((m) => m.roomId !== roomId);
	}

	reset(): void {
		this.messages = [];
		this.delivered.clear();
	}
}
