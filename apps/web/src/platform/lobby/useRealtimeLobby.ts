"use client";

/**
 * ロビーの状態と操作をまとめるフック。
 *
 * アダプタ（既定はモック）を 1 つ持ち、単一接続の多重化（ADR 0007）越しに
 * 一覧・参加・作成・退出を行う（ADR 0016）。受信メッセージは type で振り分け、
 * 自分の gameType / roomId 宛だけを反映する。UI からは状態と操作関数だけを見せ、
 * 接続の都合を持ち込まない。
 */

import type {
	GameType,
	PlayerId,
	PlayerInfo,
	RoomId,
	RoomSummary,
} from "@rondo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type RealtimeAdapter,
	createLobbyAdapter,
} from "../../infrastructure/realtime";

/** 参加中のルーム。 */
export interface JoinedRoom {
	readonly roomId: RoomId;
	readonly you: PlayerId;
	readonly players: readonly PlayerInfo[];
}

/** ロビーUI が使う状態と操作。 */
export interface LobbyApi {
	readonly rooms: readonly RoomSummary[];
	readonly joined: JoinedRoom | null;
	readonly error: string | null;
	readonly createRoom: () => void;
	readonly joinRoom: (roomId: RoomId) => void;
	readonly leaveRoom: () => void;
	readonly refresh: () => void;
}

export function useRealtimeLobby(gameType: GameType): LobbyApi {
	const adapterRef = useRef<RealtimeAdapter | null>(null);
	const [rooms, setRooms] = useState<readonly RoomSummary[]>([]);
	const [joined, setJoined] = useState<JoinedRoom | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const adapter = createLobbyAdapter();
		adapterRef.current = adapter;

		const unsubscribe = adapter.subscribe((message) => {
			switch (message.type) {
				case "room-list":
					if (message.gameType === gameType) setRooms(message.rooms);
					break;
				case "room-joined":
					if (message.gameType === gameType) {
						setError(null);
						setJoined({
							roomId: message.roomId,
							you: message.you,
							players: message.players,
						});
					}
					break;
				case "player-joined":
					setJoined((current) =>
						current === null || current.roomId !== message.roomId
							? current
							: { ...current, players: [...current.players, message.player] },
					);
					break;
				case "player-left":
					setJoined((current) =>
						current === null || current.roomId !== message.roomId
							? current
							: {
									...current,
									players: current.players.filter(
										(player) => player.playerId !== message.playerId,
									),
								},
					);
					break;
				case "error":
					setError(message.message);
					break;
				default:
					// game-started / game-state / game-ended はゲーム進行（issue-12）で扱う。
					break;
			}
		});

		adapter.send({ type: "list-rooms", gameType });

		return () => {
			unsubscribe();
			adapter.close();
			adapterRef.current = null;
		};
	}, [gameType]);

	const refresh = useCallback(() => {
		adapterRef.current?.send({ type: "list-rooms", gameType });
	}, [gameType]);

	const createRoom = useCallback(() => {
		adapterRef.current?.send({ type: "create-room", gameType });
	}, [gameType]);

	const joinRoom = useCallback(
		(roomId: RoomId) => {
			adapterRef.current?.send({ type: "join-room", gameType, roomId });
		},
		[gameType],
	);

	const leaveRoom = useCallback(() => {
		const adapter = adapterRef.current;
		if (adapter === null || joined === null) return;
		adapter.send({ type: "leave-room", roomId: joined.roomId });
		setJoined(null);
		adapter.send({ type: "list-rooms", gameType });
	}, [gameType, joined]);

	return { rooms, joined, error, createRoom, joinRoom, leaveRoom, refresh };
}
