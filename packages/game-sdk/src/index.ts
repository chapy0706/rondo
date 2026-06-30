/**
 * @rondo/game-sdk
 *
 * ゲームが基盤と話すための薄い SDK。実装（solo / realtime フック）は issue-04。
 *
 * このファイルは現時点では契約型を SDK 利用側へ再公開するだけの最小 skeleton。
 * contracts から型を import して型チェックが通ることを保証する起点でもある。
 */

export type {
	ClientMessage,
	Game,
	GameManifest,
	PlayResult,
	RealTimePort,
	RealtimeGame,
	RealtimeResult,
	ServerMessage,
	SoloGame,
} from "@rondo/contracts";
