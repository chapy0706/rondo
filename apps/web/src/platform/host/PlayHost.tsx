"use client";

/**
 * 汎用ゲームホスト（基盤 / ADR 0003・0004）。
 *
 * registry から id でゲーム本体を遅延読み込みし、ゲームに GameHost（結果の受け取り）と
 * 共通入力（VirtualPad / ADR 0018）を供給する。ここには特定ゲームの記述を持たず、
 * 表を引くだけなので、ゲームを増やしてもこのコードは変わらない。
 *
 * リアルタイム接続（realtime）はソロでは null（ADR 0004）。リアルタイム版ホストは
 * ロビー・アダプタ（issue-11）とゲーム進行（issue-12）の上に issue-14 で載せる。
 */

import type { GameManifest, PlayResult } from "@rondo/contracts";
import { GameHostProvider, VirtualPadProvider } from "@rondo/game-sdk";
import type { GameHost } from "@rondo/game-sdk";
import Link from "next/link";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { findGameLoader } from "../../games/registry";

export function PlayHost({ manifest }: { manifest: GameManifest }) {
	const [result, setResult] = useState<PlayResult | null>(null);
	const [playKey, setPlayKey] = useState(0);

	const reportResult = useCallback((value: PlayResult) => {
		setResult(value);
	}, []);

	const host = useMemo<GameHost>(
		() => ({ reportResult, realtime: null }),
		[reportResult],
	);

	const Game = useMemo(() => {
		const loader = findGameLoader(manifest.id);
		return loader ? lazy(loader) : null;
	}, [manifest.id]);

	const replay = useCallback(() => {
		setResult(null);
		setPlayKey((key) => key + 1);
	}, []);

	return (
		<GameHostProvider value={host}>
			<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-8 px-6 py-12">
				<h1 className="font-bold text-2xl text-white">{manifest.title}</h1>

				<VirtualPadProvider>
					{Game === null ? (
						<p className="text-slate-400">
							このゲームはまだ起動できません（本体が未登録）。
						</p>
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
