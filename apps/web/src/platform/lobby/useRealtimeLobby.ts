"use client";

/**
 * ロビーの状態と操作をまとめるフック。
 *
 * タブで共有するセッション（issue-40）の接続を使い、単一接続の多重化（ADR 0007）越しに
 * 一覧・参加・作成を行う（ADR 0016）。参加中のルームはセッションが持ち、ゲーム画面へ
 * そのまま引き継ぐ。このゲームのルームに参加できたら（復帰を含む）、ゲーム画面へ移る。
 * UI からは状態と操作関数だけを見せ、接続の都合を持ち込まない。
 *
 * issue-60: 一覧は、画面が見えている間、5 秒ごとに自動で取り直す（listRefresh.ts）。参加の競合（押した直後に
 * 満員・始まった・もう無い）と、作れないとき（room-limit）は、エラーが届いたら、すぐ一覧を取り直す。エラーは、
 * 種類（code）から決めた文言（serverErrors.ts）で見せる。
 */

import {
	type GameType,
	type RoomId,
	type RoomSummary,
	cleanRoomName,
} from "@rondo/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { playPathOf } from "../../games/registry";
import { type ErrorNotice, noticeFor } from "../session/serverErrors";
import { lobbyShouldEnter } from "../session/session";
import {
	getRealtimeSession,
	useSessionState,
} from "../session/useRealtimeSession";
import { browserRefreshDeps, startListRefresh } from "./listRefresh";

/** ロビーUI が使う状態と操作。 */
export interface LobbyApi {
	readonly rooms: readonly RoomSummary[];
	/** 参加できて、ゲーム画面へ移っているところか。 */
	readonly entering: boolean;
	/** 参加・作成の返事を待っているところか。 */
	readonly waiting: boolean;
	/** 案内（エラーの種類から決めた文言と、次の行動 / issue-60）。無ければ null。 */
	readonly notice: ErrorNotice | null;
	/** つながらなかった（返事が届かない・つなぎ直しをすべて失敗した / issue-47）。 */
	readonly failed: boolean;
	/** 失敗の表示を消し、一覧を取り直す。 */
	readonly retry: () => void;
	/**
	 * ルームを作る。settings はマニフェストの roomOptions で選んだ値。roomName は入力欄の
	 * 名前で、整えて空になるなら送らない（サーバーが既定の名前を付ける / issue-58）。
	 */
	readonly createRoom: (
		settings?: Readonly<Record<string, number>>,
		roomName?: string,
	) => void;
	readonly joinRoom: (roomId: RoomId) => void;
	readonly refresh: () => void;
	/** 画面を読み込み直す（前のルームに入ったままのとき）。 */
	readonly reload: () => void;
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
			// 参加の競合・作れないときは、すぐ一覧を取り直す（空きと状態を、最新にする）。
			if (message.type === "error" && noticeFor(message.code).refreshList) {
				session.send({ type: "list-rooms", gameType });
			}
		});
		// 参加・作成の返事を待つ画面として見ておく。返事の前に離れたら、届いた時点で
		// セッションが退出する（issue-47）。
		const unwatch = session.watch();
		session.send({ type: "list-rooms", gameType });
		return () => {
			unsubscribe();
			unwatch();
		};
	}, [gameType]);

	// 一覧の自動更新（画面が見えている間だけ。返事を待っている間と、ゲーム画面へ移る間は止める）。
	const busyRef = useRef(false);
	busyRef.current = state.pending?.gameType === gameType || entering;
	useEffect(
		() =>
			startListRefresh(
				browserRefreshDeps(
					() => getRealtimeSession().send({ type: "list-rooms", gameType }),
					() => busyRef.current,
				),
			),
		[gameType],
	);

	// 参加できたら、ゲーム画面へ移る。戻るでロビーに戻らないよう、履歴は置き換える
	// （ロビーに戻ると、参加中のため、またゲーム画面へ移ってしまう）。
	useEffect(() => {
		if (entering) router.replace(playPathOf(gameType));
	}, [entering, gameType, router]);

	const refresh = useCallback(() => {
		getRealtimeSession().send({ type: "list-rooms", gameType });
	}, [gameType]);

	const reload = useCallback(() => {
		window.location.reload();
	}, []);

	const retry = useCallback(() => {
		const session = getRealtimeSession();
		session.dismiss();
		session.send({ type: "list-rooms", gameType });
	}, [gameType]);

	const createRoom = useCallback(
		(settings?: Readonly<Record<string, number>>, roomName?: string) => {
			const name = cleanRoomName(roomName ?? "");
			getRealtimeSession().create(
				gameType,
				settings,
				name === "" ? undefined : name,
			);
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
		notice:
			state.failure === null && state.errorCode !== null
				? noticeFor(state.errorCode)
				: null,
		failed: state.failure !== null && !entering,
		retry,
		createRoom,
		joinRoom,
		refresh,
		reload,
	};
}
