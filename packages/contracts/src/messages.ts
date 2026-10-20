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
	/**
	 * ルーム名（issue-58）。サーバーが整えた 1〜20 文字。表示は文字として出し、HTML として
	 * 解釈しない。名前を持たない古いサーバーでは省略される。
	 */
	readonly name?: string;
	/**
	 * 観戦ルームか（issue-67）。観戦ルームのときだけ true で載る。省略は、人間が参加する対戦のルーム。
	 * 観戦ルームの playerCount と capacity は、観戦者の数と、その上限。
	 */
	readonly spectate?: true;
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
	| {
			readonly type: "create-room";
			readonly gameType: GameType;
			/**
			 * マニフェストの roomOptions で選んだ値（key -> 値）。省略時はゲームの既定値。
			 * サーバーはゲームごとに検証する（境界での unknown 検証）。
			 */
			readonly settings?: Readonly<Record<string, number>>;
			/**
			 * ルーム名（issue-58）。省略・空白だけなら、サーバーが作った人の表示名から既定の名前を
			 * 付ける。整える規則はサーバーが正（roomName.ts はその写し）。
			 */
			readonly roomName?: string;
	  }
	| {
			readonly type: "join-room";
			readonly gameType: GameType;
			readonly roomId: RoomId;
	  }
	| { readonly type: "leave-room"; readonly roomId: RoomId }
	| {
			/**
			 * 切断から再接続猶予（ADR 0013）のうちに、同じプレイヤーとして同じルームへ
			 * 復帰する（issue-31）。resumeToken は session で本人にだけ届いた秘密の値。
			 * 他の人にも見える playerId では復帰できない。
			 */
			readonly type: "reconnect";
			readonly roomId: RoomId;
			readonly resumeToken: string;
	  }
	| {
			readonly type: "game-event";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly payload: unknown;
	  }
	/**
	 * ハートビートの応答（issue-41 / ADR 0041）。サーバーの ping を受けたら返す。
	 * 接続の層だけで扱い、ルームとゲームには渡さない。
	 */
	| { readonly type: "pong" };

/**
 * サーバー -> クライアント メッセージ。
 *
 * game-state はサーバー権威の状態配信で、ルームの全員に同じ内容を送る（ADR 0014）。
 * game-state-to は特定のプレイヤーだけに宛てた状態配信（ADR 0021）。サーバーは宛先の
 * 接続にだけ送り、宛先でない接続には送らない（隠すべき情報をネットワークに流さない）。
 * 複数人に送るときも宛先ごとに1通ずつ送るため、to は受け取った本人の ID だけになる。
 * game-ended はルーム解散時の最終結果（ADR 0017）。payload はゲーム固有のため unknown
 * とし、受信側で検証する。
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
			/** 参加したルームの名前（issue-58）。名前を持たない古いサーバーでは省略される。 */
			readonly roomName?: string;
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
			readonly type: "game-state-to";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly to: PlayerId;
			readonly payload: unknown;
	  }
	| {
			readonly type: "game-ended";
			readonly gameType: GameType;
			readonly roomId: RoomId;
			readonly result: RealtimeResult;
			/**
			 * ルームが閉じるまでの残り（ミリ秒 / issue-70・ADR 0050）。通知を作った時点からの残り
			 * （ADR 0046 と同じ考え方）。結果が確定してから一定の時間がたつと、サーバーはルームを閉じ、
			 * 残っている人へ error の room-expired を送る。省略できる（無ければ、残りを出さない）。
			 */
			readonly closesInMs?: number;
	  }
	| { readonly type: "error"; readonly code: string; readonly message: string }
	| {
			/**
			 * 接続直後に、その接続にだけ送る（issue-31）。playerId はこの接続のプレイヤー
			 * 識別子（ルームの他の人にも見える）。resumeToken は再接続で同じプレイヤーに
			 * 復帰するための秘密の値で、本人以外には一切送らない。
			 */
			readonly type: "session";
			readonly playerId: PlayerId;
			readonly resumeToken: string;
	  }
	/**
	 * ハートビート（issue-41 / ADR 0041）。通信の有無にかかわらず、固定の間隔で全接続に
	 * 送る。クライアントは pong を返す。接続の層だけで扱い、ゲームには渡さない。
	 */
	| { readonly type: "ping" };
