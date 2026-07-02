/**
 * @rondo/game-sdk
 *
 * ゲームが基盤と話すための薄い SDK。契約（@rondo/contracts）の上に乗り、ゲームが
 * 基盤の内部を知らずに作れる状態を提供する。共通入力（VirtualPad）もここに置く。
 */

// 契約型の再公開（ゲームは contracts を直接 import しなくてよい）
export type {
	ClientMessage,
	Game,
	GameKind,
	GameManifest,
	PlayResult,
	RealTimePort,
	RealtimeGame,
	RealtimeResult,
	ServerMessage,
	SoloGame,
} from "@rondo/contracts";

// 入力ポートと VirtualPad の入力源（ADR 0018）
export { type Direction, type InputPort, NEUTRAL } from "./input/port";
export { VirtualPadSource } from "./input/virtual-pad";

// リアルタイムの多重化ヘルパ（ADR 0007）
export {
	type GamePayload,
	isGamePayload,
	readGameState,
	toGameEvent,
} from "./realtime/protocol";

// React ホストとフック
export {
	type GameHost,
	GameHostProvider,
	type RealtimeHost,
	useGameHost,
} from "./react/host";
export { useInput } from "./react/use-input";
export {
	VirtualPad,
	VirtualPadProvider,
	useVirtualPad,
} from "./react/virtual-pad";
export { type SoloGameApi, useSoloGame } from "./react/use-solo-game";
export {
	type RealtimeGameApi,
	useRealtimeGame,
} from "./react/use-realtime-game";
