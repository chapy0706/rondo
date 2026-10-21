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
	GameLogo,
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
export {
	ROOM_NAME_MAX_LENGTH,
	cleanRoomName,
	defaultRoomName,
	normalizeRoomName,
} from "./roomName";
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
	VeryareCpuPose,
	VeryareModelPose,
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
	VeryareLikeEvent,
	VeryareLikesNotice,
	VeryareMembersNotice,
	VeryareSightEvent,
	VeryareSpectateActor,
	VeryareSpectateLook,
	VeryareSpectateNotice,
	VeryareSpectatePose,
	VeryareWaitingMember,
	VeryareWaitingPoseEvent,
} from "./veryare";
export {
	VERYARE_CPU_POSES,
	VERYARE_MODEL_POSES,
	VERYARE_PAINT_LIMITS,
	VERYARE_PAINT_PARTS,
} from "./veryare";
