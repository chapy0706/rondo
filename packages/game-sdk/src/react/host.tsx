/**
 * ゲームホスト。
 *
 * 基盤（プラットフォーム）がゲームに提供する接点。結果の受け取りと、リアルタイム
 * 接続の口を持つ。ゲームは基盤の内部を知らず、このホスト経由でだけ基盤と話す。
 * ホストの実装は基盤側（issue-11 / issue-14）で与える。
 */

import type {
	PlayResult,
	PlayerId,
	PlayerInfo,
	RealTimePort,
	RoomId,
} from "@rondo/contracts";
import { createContext, useContext } from "react";

/** リアルタイムゲームがルームと話すためのホスト情報。ソロでは提供されない。 */
export interface RealtimeHost {
	/** 多重化された単一接続のポート（ADR 0007）。 */
	readonly port: RealTimePort;
	/** 現在参加しているルーム。 */
	readonly roomId: RoomId;
	/** このルームでの自分のプレイヤー ID（room-joined の you）。役割の判定などに使う。 */
	readonly you: PlayerId;
	/**
	 * ルームの参加者（room-joined の players に、参加・退出の知らせを反映したもの）。名前の表示に
	 * 使う（issue-59）。読み取りだけ。
	 */
	readonly players: readonly PlayerInfo[];
}

/** 基盤がゲームに提供するホスト。 */
export interface GameHost {
	/** ゲームの結果を基盤に返す。 */
	reportResult(result: PlayResult): void;
	/** リアルタイムゲームのみ利用可能。ソロでは null（ADR 0004）。 */
	readonly realtime: RealtimeHost | null;
}

const GameHostContext = createContext<GameHost | null>(null);

/** ゲームに GameHost を供給する。 */
export const GameHostProvider = GameHostContext.Provider;

/** 現在の GameHost を取得する。Provider の外で使うと例外を投げる。 */
export function useGameHost(): GameHost {
	const host = useContext(GameHostContext);
	if (host === null) {
		throw new Error("useGameHost は GameHostProvider の内側で使用してください");
	}
	return host;
}
