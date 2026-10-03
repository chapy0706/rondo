/**
 * サーバーなしで開発するためのモックアダプタ。
 *
 * Gleam サーバーの完成を待たずにフロントを進められるよう、ロビーの最小挙動
 * （一覧・作成・参加・退出 / ADR 0016）をブラウザ内で模す。返信は setTimeout で
 * 非同期にし、実接続に近い順序で購読者へ届ける。ゲーム進行は最小限だけ模し、完走の
 * 合図（type: "finished"）を受けたら結果発表（game-ended）を返す（issue-14）。
 * 本物の順位確定はサーバー権威（ADR 0008 / issue-13）が担う。
 * veryare は mockVeryare の台本どおりに、時間でフェーズ通知を流す（issue-24）。
 */

import type {
	ClientMessage,
	GameType,
	PlayerInfo,
	RoomId,
	RoomStatus,
	RoomSummary,
	ServerMessage,
} from "@rondo/contracts";
import { MultiplexingAdapter } from "./MultiplexingAdapter";
import {
	VERYARE,
	cpuOf,
	explorationSecondsOf,
	mockPlayersOf,
	nextSelfIsOni,
	veryareScript,
} from "./mockVeryare";

/** 返信までの擬似遅延（ミリ秒）。実接続の非同期性を最小限まねる。 */
const LATENCY_MS = 40;

/** モックルームの定員。 */
const CAPACITY = 4;

interface MockRoom {
	roomId: RoomId;
	gameType: GameType;
	players: PlayerInfo[];
	status: RoomStatus;
}

export class MockWebSocketAdapter extends MultiplexingAdapter {
	private readonly rooms = new Map<RoomId, MockRoom>();
	private readonly seeded = new Set<GameType>();
	private readonly endedRooms = new Set<RoomId>();
	/** veryare の台本のタイマー。閉じる・退出するときに止める。 */
	private readonly scriptTimers = new Map<
		RoomId,
		ReturnType<typeof setTimeout>[]
	>();
	private self: PlayerInfo;

	constructor() {
		super();
		// 端末保持の一時プレイヤー（ADR 0015）。既定名を即座に与える。
		this.self = { playerId: `p-${randomId()}`, name: "user1" };
	}

	send(message: ClientMessage): void {
		switch (message.type) {
			case "list-rooms":
				this.handleListRooms(message.gameType);
				break;
			case "create-room":
				if (message.gameType === VERYARE) {
					this.handleCreateVeryareRoom(message.settings);
				} else {
					this.handleCreateRoom(message.gameType);
				}
				break;
			case "join-room":
				this.handleJoinRoom(message.gameType, message.roomId);
				break;
			case "leave-room":
				this.handleLeaveRoom(message.roomId);
				break;
			case "set-name":
				this.self = { playerId: this.self.playerId, name: message.name };
				break;
			case "reconnect":
				this.handleReconnect(message.roomId);
				break;
			case "game-event":
				this.handleGameEvent(message.gameType, message.roomId, message.payload);
				break;
		}
	}

	close(): void {
		for (const roomId of this.scriptTimers.keys()) this.stopScript(roomId);
		this.rooms.clear();
		this.endedRooms.clear();
	}

	/**
	 * veryare のルームを作り、仮のプレイヤーを固定で参加させて、台本を流し始める。
	 * フェーズ判定はしない。台本の時刻どおりに通知を送るだけ。
	 */
	private handleCreateVeryareRoom(
		settings: Readonly<Record<string, number>> | undefined,
	): void {
		const room: MockRoom = {
			roomId: `room-${randomId()}`,
			gameType: VERYARE,
			players: [this.self, ...mockPlayersOf(cpuOf(settings))],
			status: "playing",
		};
		this.rooms.set(room.roomId, room);
		this.emit({
			type: "room-joined",
			gameType: VERYARE,
			roomId: room.roomId,
			you: this.self.playerId,
			players: [...room.players],
		});

		const script = veryareScript({
			roomId: room.roomId,
			self: this.self.playerId,
			selfIsOni: nextSelfIsOni(),
			explorationSeconds: explorationSecondsOf(settings),
			cpu: cpuOf(settings),
		});
		this.scriptTimers.set(
			room.roomId,
			script.map(({ afterMs, message }) =>
				setTimeout(() => this.dispatch(message), LATENCY_MS * 2 + afterMs),
			),
		);
	}

	private stopScript(roomId: RoomId): void {
		for (const timer of this.scriptTimers.get(roomId) ?? [])
			clearTimeout(timer);
		this.scriptTimers.delete(roomId);
	}

	private handleListRooms(gameType: GameType): void {
		this.ensureSeeded(gameType);
		this.emitRoomList(gameType);
	}

	private handleCreateRoom(gameType: GameType): void {
		const room: MockRoom = {
			roomId: `room-${randomId()}`,
			gameType,
			players: [this.self],
			status: "waiting",
		};
		this.rooms.set(room.roomId, room);
		this.emit({
			type: "room-joined",
			gameType,
			roomId: room.roomId,
			you: this.self.playerId,
			players: [...room.players],
		});
	}

	private handleJoinRoom(gameType: GameType, roomId: RoomId): void {
		const room = this.rooms.get(roomId);
		if (room === undefined) {
			this.emit({
				type: "error",
				code: "room-not-found",
				message: "そのルームは見つかりませんでした。",
			});
			return;
		}
		if (room.players.length >= CAPACITY) {
			this.emit({
				type: "error",
				code: "room-full",
				message: "そのルームは満員です。",
			});
			return;
		}
		if (
			!room.players.some((player) => player.playerId === this.self.playerId)
		) {
			room.players.push(this.self);
		}
		this.emit({
			type: "room-joined",
			gameType,
			roomId,
			you: this.self.playerId,
			players: [...room.players],
		});
	}

	private handleLeaveRoom(roomId: RoomId): void {
		this.stopScript(roomId);
		const room = this.rooms.get(roomId);
		if (room === undefined) return;
		room.players = room.players.filter(
			(player) => player.playerId !== this.self.playerId,
		);
		// 誰も残らなければルームは消える（解散 / ADR 0017）。
		if (room.players.length === 0) {
			this.rooms.delete(roomId);
			this.endedRooms.delete(roomId);
		}
	}

	/**
	 * ゲーム内イベントを受ける。順位確定はサーバー本体の権威（ADR 0008 / issue-13）だが、
	 * モックは最小の合図（type: "finished"）だけを見て結果発表を返す。単一クライアントの
	 * モックでは自分が唯一の完走者。順位はサーバー受信順の思想に沿う（ADR 0014）。
	 */
	private handleGameEvent(
		gameType: GameType,
		roomId: RoomId,
		payload: unknown,
	): void {
		if (!this.rooms.has(roomId)) return;
		if (!isFinishedSignal(payload)) return;
		if (this.endedRooms.has(roomId)) return;
		this.endedRooms.add(roomId);
		this.emit({
			type: "game-ended",
			gameType,
			roomId,
			result: {
				order: "lower-is-better",
				rankings: [
					{
						playerId: this.self.playerId,
						name: this.self.name,
						rank: 1,
						result: { score: 1 },
					},
				],
			},
		});
	}

	private handleReconnect(roomId: RoomId): void {
		const room = this.rooms.get(roomId);
		if (room === undefined) {
			this.emit({
				type: "error",
				code: "room-not-found",
				message: "再接続先のルームが見つかりませんでした。",
			});
			return;
		}
		this.emit({
			type: "room-joined",
			gameType: room.gameType,
			roomId,
			you: this.self.playerId,
			players: [...room.players],
		});
	}

	/** 初回の一覧要求時に、遊べるルームがある状態を作る（デモ・開発用）。 */
	private ensureSeeded(gameType: GameType): void {
		if (this.seeded.has(gameType)) return;
		this.seeded.add(gameType);
		for (let index = 0; index < 2; index++) {
			const room: MockRoom = {
				roomId: `room-${randomId()}`,
				gameType,
				players: [{ playerId: `p-${randomId()}`, name: `user${index + 2}` }],
				status: "waiting",
			};
			this.rooms.set(room.roomId, room);
		}
	}

	private emitRoomList(gameType: GameType): void {
		const rooms: RoomSummary[] = [];
		for (const room of this.rooms.values()) {
			if (room.gameType !== gameType) continue;
			rooms.push({
				roomId: room.roomId,
				gameType: room.gameType,
				playerCount: room.players.length,
				capacity: CAPACITY,
				status: room.status,
			});
		}
		this.emit({ type: "room-list", gameType, rooms });
	}

	private emit(message: ServerMessage): void {
		setTimeout(() => this.dispatch(message), LATENCY_MS);
	}
}

function randomId(): string {
	return Math.random().toString(36).slice(2, 8);
}

/** 完走の合図（type: "finished"）か。ゲーム固有の意味づけには踏み込まない。 */
function isFinishedSignal(payload: unknown): boolean {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"type" in payload &&
		(payload as { type: unknown }).type === "finished"
	);
}
