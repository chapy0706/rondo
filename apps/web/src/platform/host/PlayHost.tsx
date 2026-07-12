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
 * 既定は Mock（issue-11）なのでサーバーなしでも遊べる。一覧から選ぶ導線（ADR 0016）と
 * サーバー結果の受け取りは issue-14 で整える。
 */

import type { GameManifest, PlayResult } from "@rondo/contracts";
import {
	type GameHost,
	GameHostProvider,
	type RealtimeHost,
	VirtualPadProvider,
} from "@rondo/game-sdk";
import Link from "next/link";
import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { findGameLoader } from "../../games/registry";
import { createLobbyAdapter } from "../../infrastructure/realtime";

/**
 * リアルタイムゲーム用のホストを用意する。gameType が null（ソロ）なら接続しない。
 * 部屋に入れるまでは null を返し、呼び出し側は「接続中」を表示する。
 */
function useRealtimeHost(gameType: string | null): RealtimeHost | null {
	const [host, setHost] = useState<RealtimeHost | null>(null);

	useEffect(() => {
		if (gameType === null) return;
		const adapter = createLobbyAdapter();
		const unsubscribe = adapter.subscribe((message) => {
			if (message.type === "room-joined" && message.gameType === gameType) {
				setHost({ port: adapter, roomId: message.roomId });
			}
		});
		// 一覧から選ぶ導線（issue-14）が入るまでは、遊べるよう自動で部屋を作る（ADR 0016）。
		adapter.send({ type: "create-room", gameType });
		return () => {
			unsubscribe();
			adapter.close();
			setHost(null);
		};
	}, [gameType]);

	return host;
}

export function PlayHost({ manifest }: { manifest: GameManifest }) {
	const [result, setResult] = useState<PlayResult | null>(null);
	const [playKey, setPlayKey] = useState(0);

	const isRealtime = manifest.kind === "realtime";
	const realtime = useRealtimeHost(isRealtime ? manifest.id : null);

	const reportResult = useCallback((value: PlayResult) => {
		setResult(value);
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
		setResult(null);
		setPlayKey((key) => key + 1);
	}, []);

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

				<Link href="/select" className="text-indigo-400 text-sm underline">
					ゲーム選択へ戻る
				</Link>
			</main>

			{result !== null && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/70 px-6">
					<div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-slate-800 p-6">
						<h2 className="font-bold text-white text-xl">おしまい</h2>
						<p className="text-slate-300">スコア {result.score}</p>
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
