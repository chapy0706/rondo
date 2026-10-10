/**
 * @rondo/contracts
 *
 * サーバー・クライアント・ゲームの間でやり取りする型の取り決め。
 * 全パッケージが参照する中心であり、契約は TypeScript を正とする（ADR 0009）。
 */

export type { Game, RealTimePort, RealtimeGame, SoloGame } from "./game";
export {
	CLIENT_MESSAGE_TYPES,
	SERVER_MESSAGE_TYPES,
} from "./messageTypes";
export type {
	GameKind,
	GameManifest,
	LaunchScreen,
	RoomOption,
} from "./manifest";
export type {
	ClientMessage,
	GameType,
	PlayerId,
	PlayerInfo,
	RoomId,
	RoomStatus,
	RoomSummary,
	ServerMessage,
} from "./messages";
export type {
	PlayResult,
	RankingEntry,
	RealtimeResult,
	Score,
	ScoreOrder,
} from "./result";
export type {
	VeryareCell,
	VeryareHiderState,
	VeryareHidersNotice,
	VeryareHidingNotice,
	VeryareOniNotice,
	VeryarePaint,
	VeryarePaintEvent,
	VeryarePaintPart,
	VeryarePose,
	VeryareStroke,
	VeryareStrokePoint,
	VeryareStrokesPaint,
	VeryareUniformPaint,
	VeryareShootEvent,
	VeryareDoorKind,
	VeryareDoorsNotice,
	VeryareEdge,
	VeryareOpenDoorEvent,
	VeryareStageDoor,
	VeryareStageNotice,
} from "./veryare";
export { VERYARE_PAINT_LIMITS } from "./veryare";
