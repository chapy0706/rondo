"use client";

/**
 * 汎用ゲームホスト（基盤 / ADR 0003・0004）。
 *
 * registry から id でゲーム本体を遅延読み込みし、ゲームに GameHost（結果の受け取り）と
 * 共通入力（VirtualPad / ADR 0018）を供給する。ここには特定ゲームの記述を持たず、
 * 表を引くだけなので、ゲームを増やしてもこのコードは変わらない。
 *
 * ソロは realtime を持たない（ADR 0004）。リアルタイムゲームには、単一接続の多重化
 * （ADR 0007）を担うアダプタで自動的に部屋へ入り、RealTimePort と roomId を渡す。
 * サーバーが確定した game-ended を受け取ったら結果発表（ADR 0017 / 0014）を出し、
 * 退出でルームの解散へ繋ぐ。既定は Mock（issue-11）なのでサーバーなしでも動く。
 */

import type {
	GameManifest,
	PlayResult,
	PlayerId,
	RealtimeResult,
	RoomId,
} from "@rondo/contracts";
import {
	type GameHost,
	GameHostProvider,
	type RealtimeHost,
	VirtualPadProvider,
} from "@rondo/game-sdk";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { findGameLoader } from "../../games/registry";
import {
	type RealtimeAdapter,
	createLobbyAdapter,
} from "../../infrastructure/realtime";
import { ResultScreen } from "../result/ResultScreen";

interface RealtimeSession {
	readonly realtime: RealtimeHost | null;
	readonly result: RealtimeResult | null;
	readonly you: PlayerId | null;
	readonly leave: () => void;
}

/**
 * リアルタイムゲーム用のセッション。gameType が null（ソロ）なら接続しない。
 * 部屋に入るまで realtime は null。サーバーの game-ended を受けたら result に確定結果を持つ。
 */
function useRealtimeSession(gameType: string | null): RealtimeSession {
	const [realtime, setRealtime] = useState<RealtimeHost | null>(null);
	const [result, setResult] = useState<RealtimeResult | null>(null);
	const [you, setYou] = useState<PlayerId | null>(null);
	const adapterRef = useRef<RealtimeAdapter | null>(null);
	const roomRef = useRef<RoomId | null>(null);

	useEffect(() => {
		if (gameType === null) return;
		const adapter = createLobbyAdapter();
		adapterRef.current = adapter;
		const unsubscribe = adapter.subscribe((message) => {
			if (message.type === "room-joined" && message.gameType === gameType) {
				roomRef.current = message.roomId;
				setYou(message.you);
				setRealtime({ port: adapter, roomId: message.roomId });
			} else if (
				message.type === "game-ended" &&
				message.gameType === gameType
			) {
				setResult(message.result);
			}
		});
		// 一覧から選ぶ導線（ADR 0016）が入るまでは、遊べるよう自動で部屋を作る。
		adapter.send({ type: "create-room", gameType });
		return () => {
			unsubscribe();
			adapter.close();
			adapterRef.current = null;
			roomRef.current = null;
			setRealtime(null);
			setResult(null);
			setYou(null);
		};
	}, [gameType]);

	const leave = useCallback(() => {
		const adapter = adapterRef.current;
		const roomId = roomRef.current;
		if (adapter !== null && roomId !== null) {
			// 退出でルームは解散する（ADR 0017）。
			adapter.send({ type: "leave-room", roomId });
		}
	}, []);

	return { realtime, result, you, leave };
}

export function PlayHost({ manifest }: { manifest: GameManifest }) {
	const router = useRouter();
	const [soloResult, setSoloResult] = useState<PlayResult | null>(null);
	const [playKey, setPlayKey] = useState(0);

	const isRealtime = manifest.kind === "realtime";
	const { realtime, result, you, leave } = useRealtimeSession(
		isRealtime ? manifest.id : null,
	);

	const reportResult = useCallback((value: PlayResult) => {
		setSoloResult(value);
	}, []);

	const host = useMemo<GameHost>(
		() => ({ reportResult, realtime }),
		[reportResult, realtime],
	);

	const Game = useMemo(() => {
		const loader = findGameLoader(manifest.id);
		return loader ? lazy(loader) : null;
	}, [manifest.id]);

	const replay = useCallback(() => {
		setSoloResult(null);
		setPlayKey((key) => key + 1);
	}, []);

	const leaveRoom = useCallback(() => {
		leave();
		router.push("/select");
	}, [leave, router]);

	const connecting = isRealtime && realtime === null;

	return (
		<GameHostProvider value={host}>
			<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-8 px-6 py-12">
				<h1 className="font-bold text-2xl text-white">{manifest.title}</h1>

				<VirtualPadProvider>
					{Game === null ? (
						<p className="text-slate-400">
							このゲームはまだ起動できません（本体が未登録）。
						</p>
					) : connecting ? (
						<p className="text-slate-400">ルームに接続中...</p>
					) : (
						<Suspense
							fallback={<p className="text-slate-400">読み込み中...</p>}
						>
							<Game key={playKey} />
						</Suspense>
					)}
				</VirtualPadProvider>

				{result !== null && (
					<ResultScreen result={result} you={you} onLeave={leaveRoom} />
				)}

				<Link href="/select" className="text-indigo-400 text-sm underline">
					ゲーム選択へ戻る
				</Link>
			</main>

			{soloResult !== null && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/70 px-6">
					<div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-slate-800 p-6">
						<h2 className="font-bold text-white text-xl">おしまい</h2>
						<p className="text-slate-300">スコア {soloResult.score}</p>
						<button
							type="button"
							onClick={replay}
							className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white"
						>
							もう一度遊ぶ
						</button>
						<Link href="/select" className="text-indigo-400 text-sm underline">
							ゲーム選択へ戻る
						</Link>
					</div>
				</div>
			)}
		</GameHostProvider>
	);
}
