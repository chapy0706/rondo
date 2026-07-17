"use client";

/**
 * 結果発表（基盤 / ADR 0017）。
 *
 * サーバーが確定した順位（RealtimeResult）を表示する。順位はサーバー受信順で決まり
 * （ADR 0014）、この画面は表示だけを担う。軌跡などその回の結果は children で受け取り、
 * ゲームが描いたものをそのまま差し込める（基盤はゲームの中身を知らない）。
 * 結果は保存しない（ADR 0019）。退出でルームの解散へ繋ぐ。
 */

import type { PlayerId, RealtimeResult } from "@rondo/contracts";
import type { ReactNode } from "react";

export function ResultScreen({
	result,
	you,
	onLeave,
	children,
}: {
	result: RealtimeResult;
	you: PlayerId | null;
	onLeave: () => void;
	children?: ReactNode;
}) {
	const ranked = [...result.rankings].sort((a, b) => a.rank - b.rank);

	return (
		<section className="flex w-full flex-col items-center gap-5">
			<h2 className="font-bold text-2xl text-white">結果発表</h2>

			{children}

			<ol className="flex w-full max-w-xs flex-col gap-2">
				{ranked.map((entry) => (
					<li
						key={entry.playerId}
						className="flex items-center gap-3 rounded-xl bg-slate-800 px-4 py-3"
					>
						<span className="w-10 shrink-0 font-bold text-indigo-400 text-lg">
							{entry.rank}位
						</span>
						<span className="text-white">{entry.name}</span>
						{entry.playerId === you && (
							<span className="text-indigo-400 text-xs">あなた</span>
						)}
					</li>
				))}
			</ol>

			<button
				type="button"
				onClick={onLeave}
				className="w-full max-w-xs rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white"
			>
				退出する
			</button>

			<p className="max-w-xs text-center text-slate-500 text-xs">
				この結果は保存されません（ADR 0019）。退出するとルームは解散します（ADR
				0017）。
			</p>
		</section>
	);
}
