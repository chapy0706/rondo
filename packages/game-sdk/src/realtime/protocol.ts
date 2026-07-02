/**
 * リアルタイムのゲームペイロードと、多重化メッセージの相互変換。
 *
 * 単一接続の多重化（ADR 0007）はゲームから隠し、ゲームは自分のペイロードだけを
 * 送受信する。ここでは gameType / roomId の付与と、宛先・形式の検証を担う。
 */

import type {
	ClientMessage,
	GameType,
	RoomId,
	ServerMessage,
} from "@rondo/contracts";

/** ゲーム固有ペイロードの最小形。多重化後にゲームが type で解釈する。 */
export interface GamePayload {
	readonly type: string;
}

/** 値が最小形（string の type を持つ）かを検証する（境界での unknown 検証）。 */
export function isGamePayload(value: unknown): value is GamePayload {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof (value as { type: unknown }).type === "string"
	);
}

/** ゲームペイロードを、多重化キー付きの game-event メッセージに包む（ADR 0007）。 */
export function toGameEvent(
	gameType: GameType,
	roomId: RoomId,
	payload: GamePayload,
): ClientMessage {
	return { type: "game-event", gameType, roomId, payload };
}

/**
 * サーバーメッセージから、自分のゲーム・ルーム宛の game-state ペイロードを取り出す。
 * 宛先が違う、または形式が不正なら null を返す。順位等の決定はサーバー権威（ADR 0014）。
 */
export function readGameState(
	message: ServerMessage,
	gameType: GameType,
	roomId: RoomId,
): GamePayload | null {
	if (message.type !== "game-state") return null;
	if (message.gameType !== gameType || message.roomId !== roomId) return null;
	return isGamePayload(message.payload) ? message.payload : null;
}
