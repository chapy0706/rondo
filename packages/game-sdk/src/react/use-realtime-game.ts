import type { GameManifest, PlayerId, PlayerInfo } from "@rondo/contracts";
import { useCallback, useEffect, useRef } from "react";
import {
	type GamePayload,
	dispatchGameState,
	toGameEvent,
} from "../realtime/protocol";
import { useGameHost } from "./host";

/** リアルタイムゲーム用フックが返す API。 */
export interface RealtimeGameApi {
	/** ゲームペイロードを送る。順位等の決定権はサーバーにある（ADR 0014）。 */
	send: (payload: GamePayload) => void;
	/** 指定 type のサーバーペイロードを購読する。購読解除の関数を返す。 */
	on: (type: string, handler: (payload: GamePayload) => void) => () => void;
	/** このルームでの自分のプレイヤー ID。ルームに入る前は null。 */
	you: PlayerId | null;
	/** ルームの参加者（名前の表示用 / issue-59）。ルームに入る前は空。 */
	players: readonly PlayerInfo[];
}

const NO_PLAYERS: readonly PlayerInfo[] = [];

/**
 * リアルタイムゲーム用フック。
 *
 * ルーム接続を扱う（ADR 0004）。単一接続の多重化（ADR 0007）は基盤の RealTimePort が
 * 担い、ゲームは gameType / roomId を意識せず自分のペイロードだけを送受信する。
 */
export function useRealtimeGame(manifest: GameManifest): RealtimeGameApi {
	const host = useGameHost();
	const realtime = host.realtime;
	const gameType = manifest.id;

	// type -> handlers。購読は subscribe 1 本にまとめ、受信を type で振り分ける。
	const handlersRef = useRef(
		new Map<string, Set<(payload: GamePayload) => void>>(),
	);

	const send = useCallback(
		(payload: GamePayload) => {
			if (realtime === null) {
				throw new Error(
					`RealtimeGame "${gameType}" には RealtimeHost が必要です（ソロ用ホストでは使えません）`,
				);
			}
			realtime.port.send(toGameEvent(gameType, realtime.roomId, payload));
		},
		[realtime, gameType],
	);

	// 参加者が変わってもホストの値は作り直されるので、購読は口とルームが変わったときだけ張り直す。
	const port = realtime?.port ?? null;
	const roomId = realtime?.roomId ?? null;
	useEffect(() => {
		if (port === null || roomId === null) return;
		const handlers = handlersRef.current;
		// 全員宛て（game-state）も限定配信（game-state-to）も同じ on に届く（ADR 0021）。
		return port.subscribe((message) =>
			dispatchGameState(message, gameType, roomId, handlers),
		);
	}, [port, roomId, gameType]);

	const on = useCallback(
		(type: string, handler: (payload: GamePayload) => void) => {
			const handlers = handlersRef.current;
			let set = handlers.get(type);
			if (set === undefined) {
				set = new Set();
				handlers.set(type, set);
			}
			set.add(handler);
			return () => {
				set.delete(handler);
			};
		},
		[],
	);

	return {
		send,
		on,
		you: realtime?.you ?? null,
		players: realtime?.players ?? NO_PLAYERS,
	};
}
