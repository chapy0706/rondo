"use client";

/**
 * ロビーの状態と操作をまとめるフック。
 *
 * タブで共有するセッション（issue-40）の接続を使い、単一接続の多重化（ADR 0007）越しに
 * 一覧・参加・作成を行う（ADR 0016）。参加中のルームはセッションが持ち、ゲーム画面へ
 * そのまま引き継ぐ。このゲームのルームに参加できたら（復帰を含む）、ゲーム画面へ移る。
 * UI からは状態と操作関数だけを見せ、接続の都合を持ち込まない。
 */

import type { GameType, RoomId, RoomSummary } from "@rondo/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { playPathOf } from "../../games/registry";
import { lobbyShouldEnter } from "../session/session";
import {
	getRealtimeSession,
	useSessionState,
} from "../session/useRealtimeSession";

/** ロビーUI が使う状態と操作。 */
export interface LobbyApi {
	readonly rooms: readonly RoomSummary[];
	/** 参加できて、ゲーム画面へ移っているところか。 */
	readonly entering: boolean;
	/** 参加・作成の返事を待っているところか。 */
	readonly waiting: boolean;
	readonly error: string | null;
	/** ルームを作る。settings はマニフェストの roomOptions で選んだ値。 */
	readonly createRoom: (settings?: Readonly<Record<string, number>>) => void;
	readonly joinRoom: (roomId: RoomId) => void;
	readonly refresh: () => void;
}

export function useRealtimeLobby(gameType: GameType): LobbyApi {
	const router = useRouter();
	const state = useSessionState();
	const [rooms, setRooms] = useState<readonly RoomSummary[]>([]);
	const entering = lobbyShouldEnter(state, gameType);

	useEffect(() => {
		const session = getRealtimeSession();
		const unsubscribe = session.subscribe((message) => {
			if (message.type === "room-list" && message.gameType === gameType) {
				setRooms(message.rooms);
			}
		});
		session.send({ type: "list-rooms", gameType });
		return unsubscribe;
	}, [gameType]);

	// 参加できたら、ゲーム画面へ移る。戻るでロビーに戻らないよう、履歴は置き換える
	// （ロビーに戻ると、参加中のため、またゲーム画面へ移ってしまう）。
	useEffect(() => {
		if (entering) router.replace(playPathOf(gameType));
	}, [entering, gameType, router]);

	const refresh = useCallback(() => {
		getRealtimeSession().send({ type: "list-rooms", gameType });
	}, [gameType]);

	const createRoom = useCallback(
		(settings?: Readonly<Record<string, number>>) => {
			getRealtimeSession().create(gameType, settings);
		},
		[gameType],
	);

	const joinRoom = useCallback(
		(roomId: RoomId) => {
			getRealtimeSession().join(gameType, roomId);
		},
		[gameType],
	);

	return {
		rooms,
		entering,
		waiting: state.pending?.gameType === gameType,
		error: state.error,
		createRoom,
		joinRoom,
		refresh,
	};
}
