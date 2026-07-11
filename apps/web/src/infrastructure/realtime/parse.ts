/**
 * サーバーから受け取る値の境界検証。
 *
 * WebSocket からの入力は unknown であり、型の嘘を通さないためにここで
 * ServerMessage へ検証してから扱う（境界での unknown 検証 / ADR 0009）。
 * zod は導入せず、contracts の isGamePayload と同じ手書きの述語で揃える。
 * game-state / game-ended のゲーム固有ペイロードは、さらにゲーム側の境界で
 * 再検証される前提とし、ここではエンベロープと既知の形だけを保証する。
 */

import type {
	PlayResult,
	PlayerInfo,
	RankingEntry,
	RealtimeResult,
	RoomStatus,
	RoomSummary,
	ServerMessage,
} from "@rondo/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRoomStatus(value: unknown): value is RoomStatus {
	return value === "waiting" || value === "playing";
}

/** 各要素を検証し、1 つでも不正なら全体を null にする。 */
function toArray<T>(
	value: unknown,
	each: (item: unknown) => T | null,
): readonly T[] | null {
	if (!Array.isArray(value)) return null;
	const out: T[] = [];
	for (const item of value) {
		const parsed = each(item);
		if (parsed === null) return null;
		out.push(parsed);
	}
	return out;
}

function toRoomSummary(value: unknown): RoomSummary | null {
	if (!isRecord(value)) return null;
	const { roomId, gameType, playerCount, capacity, status } = value;
	if (!isString(roomId) || !isString(gameType)) return null;
	if (!isNumber(playerCount) || !isNumber(capacity)) return null;
	if (!isRoomStatus(status)) return null;
	return { roomId, gameType, playerCount, capacity, status };
}

function toPlayerInfo(value: unknown): PlayerInfo | null {
	if (!isRecord(value)) return null;
	const { playerId, name } = value;
	if (!isString(playerId) || !isString(name)) return null;
	return { playerId, name };
}

function toPlayResult(value: unknown): PlayResult | null {
	if (!isRecord(value)) return null;
	const { score, details } = value;
	if (!isNumber(score)) return null;
	if (details === undefined) return { score };
	if (!isRecord(details)) return null;
	for (const entry of Object.values(details)) {
		if (!isString(entry) && !isNumber(entry)) return null;
	}
	return {
		score,
		details: details as Readonly<Record<string, number | string>>,
	};
}

function toRankingEntry(value: unknown): RankingEntry | null {
	if (!isRecord(value)) return null;
	const { playerId, name, rank } = value;
	if (!isString(playerId) || !isString(name) || !isNumber(rank)) return null;
	const result = toPlayResult(value.result);
	if (result === null) return null;
	return { playerId, name, rank, result };
}

function toRealtimeResult(value: unknown): RealtimeResult | null {
	if (!isRecord(value)) return null;
	const { order } = value;
	if (order !== "higher-is-better" && order !== "lower-is-better") return null;
	const rankings = toArray(value.rankings, toRankingEntry);
	if (rankings === null) return null;
	return { order, rankings };
}

/**
 * unknown を ServerMessage に検証する。宛先・形式が不正なら null を返す。
 * 呼び出し側（アダプタ）は null を「無視すべき不正な入力」として扱う。
 */
export function parseServerMessage(value: unknown): ServerMessage | null {
	if (!isRecord(value)) return null;
	const { type } = value;

	switch (type) {
		case "room-list": {
			const { gameType } = value;
			if (!isString(gameType)) return null;
			const rooms = toArray(value.rooms, toRoomSummary);
			if (rooms === null) return null;
			return { type, gameType, rooms };
		}
		case "room-joined": {
			const { gameType, roomId, you } = value;
			if (!isString(gameType) || !isString(roomId) || !isString(you)) {
				return null;
			}
			const players = toArray(value.players, toPlayerInfo);
			if (players === null) return null;
			return { type, gameType, roomId, you, players };
		}
		case "player-joined": {
			const { roomId } = value;
			if (!isString(roomId)) return null;
			const player = toPlayerInfo(value.player);
			if (player === null) return null;
			return { type, roomId, player };
		}
		case "player-left": {
			const { roomId, playerId } = value;
			if (!isString(roomId) || !isString(playerId)) return null;
			return { type, roomId, playerId };
		}
		case "game-started": {
			const { gameType, roomId } = value;
			if (!isString(gameType) || !isString(roomId)) return null;
			return { type, gameType, roomId };
		}
		case "game-state": {
			const { gameType, roomId } = value;
			if (!isString(gameType) || !isString(roomId)) return null;
			// payload はゲーム固有のため unknown のまま渡し、ゲーム側の境界で検証する。
			return { type, gameType, roomId, payload: value.payload };
		}
		case "game-ended": {
			const { gameType, roomId } = value;
			if (!isString(gameType) || !isString(roomId)) return null;
			const result = toRealtimeResult(value.result);
			if (result === null) return null;
			return { type, gameType, roomId, result };
		}
		case "error": {
			const { code, message } = value;
			if (!isString(code) || !isString(message)) return null;
			return { type, code, message };
		}
		default:
			return null;
	}
}

/** JSON 文字列を安全に unknown へ。パースに失敗したら null。 */
export function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}
