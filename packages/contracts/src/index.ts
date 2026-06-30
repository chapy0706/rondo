/**
 * @rondo/contracts
 *
 * サーバー・クライアント・ゲームの間でやり取りする型の取り決め。
 * 全パッケージが参照する中心であり、契約は TypeScript を正とする（ADR 0009）。
 */

export type { Game, RealTimePort, RealtimeGame, SoloGame } from "./game";
export type { GameKind, GameManifest } from "./manifest";
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
