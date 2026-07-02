import type { GameManifest } from "@rondo/contracts";
import { useCallback, useEffect, useRef } from "react";
import {
	type GamePayload,
	readGameState,
	toGameEvent,
} from "../realtime/protocol";
import { useGameHost } from "./host";

/** リアルタイムゲーム用フックが返す API。 */
export interface RealtimeGameApi {
	/** ゲームペイロードを送る。順位等の決定権はサーバーにある（ADR 0014）。 */
	send: (payload: GamePayload) => void;
	/** 指定 type のサーバーペイロードを購読する。購読解除の関数を返す。 */
	on: (type: string, handler: (payload: GamePayload) => void) => () => void;
}

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

	useEffect(() => {
		if (realtime === null) return;
		const { port, roomId } = realtime;
		const handlers = handlersRef.current;
		return port.subscribe((message) => {
			const payload = readGameState(message, gameType, roomId);
			if (payload === null) return;
			const set = handlers.get(payload.type);
			if (set === undefined) return;
			for (const handler of set) {
				handler(payload);
			}
		});
	}, [realtime, gameType]);

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

	return { send, on };
}
