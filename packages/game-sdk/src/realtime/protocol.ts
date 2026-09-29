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
 * サーバーメッセージから、自分のゲーム・ルーム宛の状態ペイロードを取り出す。
 * 宛先が違う、または形式が不正なら null を返す。順位等の決定はサーバー権威（ADR 0014）。
 *
 * 全員宛て（game-state）と限定配信（game-state-to / ADR 0021）を同じ形で返し、
 * ゲームコードに違いを意識させない。限定配信は宛先の接続にしか届かない（サーバーが
 * 宛先でない接続には送らない）ため、ここで to を見て捨てることはしない。
 */
export function readGameState(
	message: ServerMessage,
	gameType: GameType,
	roomId: RoomId,
): GamePayload | null {
	if (message.type !== "game-state" && message.type !== "game-state-to") {
		return null;
	}
	if (message.gameType !== gameType || message.roomId !== roomId) return null;
	return isGamePayload(message.payload) ? message.payload : null;
}

/** ペイロードの type ごとの購読ハンドラ。 */
export type GameStateHandlers = ReadonlyMap<
	string,
	ReadonlySet<(payload: GamePayload) => void>
>;

/**
 * 受信したサーバーメッセージを、ペイロードの type で購読ハンドラへ振り分ける。
 * useRealtimeGame の on はこれを通して受け取る。
 */
export function dispatchGameState(
	message: ServerMessage,
	gameType: GameType,
	roomId: RoomId,
	handlers: GameStateHandlers,
): void {
	const payload = readGameState(message, gameType, roomId);
	if (payload === null) return;
	for (const handler of handlers.get(payload.type) ?? []) {
		handler(payload);
	}
}
