/**
 * WebSocket メッセージ契約。
 *
 * クライアントとサーバーの間は単一の WebSocket 接続を多重化する（ADR 0007）。
 * そのため、すべてのメッセージは type を持ち、ルーティングに必要な種別
 * （gameType / roomId 等）を載せる。クライアントの WebSocketAdapter と
 * サーバーの protocol が、この型を見て多重化する。
 *
 * 契約は TypeScript を正とする（ADR 0009）。Gleam 側の protocol/message.gleam を
 * これに対応させる（issue-08 以降）。
 */

import type { RealtimeResult } from "./result";

/** ルーム識別子。 */
export type RoomId = string;

/** プレイヤー識別子。端末が保持する一時的な ID（ADR 0015）。 */
export type PlayerId = string;

/** ゲーム種別。マニフェストの id と対応し、多重化のルーティングに使う（ADR 0007）。 */
export type GameType = string;

/** ルーム内の進行状態。 */
export type RoomStatus = "waiting" | "playing";

/** プレイヤーの公開情報。表示名は端末保持の一時名（ADR 0015）。 */
export interface PlayerInfo {
	readonly playerId: PlayerId;
	readonly name: string;
}

/** ロビーのルーム一覧に並べる1ルームの要約。 */
export interface RoomSummary {
	readonly roomId: RoomId;
	readonly gameType: GameType;
	readonly playerCount: number;
	readonly capacity: number;
	readonly status: RoomStatus;
}

/**
 * クライアント -> サーバー メッセージ。
 *
 * ゲーム内のイベントは payload を unknown とし、種別ごとの意味づけはゲームに委ねる。
 * 受け取った境界（サーバー / SDK）で検証してから扱う（境界での unknown 検証）。
 * 順位の決定権はクライアントにはなく、到達等を通知するだけである（ADR 0014）。
 */
export type ClientMessage =
	| {
			readonly type: "set-name";
			readonly playerId: PlayerId;
			readonly name: string;
	  }
	| { readonly type: "list-rooms"; readonly gameType: GameType }
	| { readonly type: "create-room"; readonly gameType: GameType }
	| {
			readonly type: "join-room";
			readonly gameType: GameType;
			readonly roomId: RoomId;
	  }
	| { readonly type: "leave-room"; readonly roomId: RoomId }
	| {
			readonly type: "reconnect";
			readonly roomId: RoomId;
			readonly playerId: PlayerId;
	  }
	| {
			readonly type: "game-event";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly payload: unknown;
	  };

/**
 * サーバー -> クライアント メッセージ。
 *
 * game-state はサーバー権威の状態配信（ADR 0014）。game-ended はルーム解散時の
 * 最終結果（ADR 0017）。payload はゲーム固有のため unknown とし、受信側で検証する。
 */
export type ServerMessage =
	| {
			readonly type: "room-list";
			readonly gameType: GameType;
			readonly rooms: readonly RoomSummary[];
	  }
	| {
			readonly type: "room-joined";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly you: PlayerId;
			readonly players: readonly PlayerInfo[];
	  }
	| {
			readonly type: "player-joined";
			readonly roomId: RoomId;
			readonly player: PlayerInfo;
	  }
	| {
			readonly type: "player-left";
			readonly roomId: RoomId;
			readonly playerId: PlayerId;
	  }
	| {
			readonly type: "game-started";
			readonly gameType: GameType;
			readonly roomId: RoomId;
	  }
	| {
			readonly type: "game-state";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly payload: unknown;
	  }
	| {
			readonly type: "game-ended";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly result: RealtimeResult;
	  }
	| { readonly type: "error"; readonly code: string; readonly message: string };
