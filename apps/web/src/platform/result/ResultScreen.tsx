"use client";

/**
 * 結果発表（基盤 / ADR 0017）。
 *
 * サーバーが確定した順位（RealtimeResult）を表示する。順位はサーバー受信順で決まり
 * （ADR 0014）、この画面は表示だけを担う。軌跡などその回の結果は children で受け取り、
 * ゲームが描いたものをそのまま差し込める（基盤はゲームの中身を知らない）。
 * 結果は保存しない（ADR 0019）。退出でルームの解散へ繋ぐ。
 *
 * 画面いっぱいの枠（fill。すごくアレ）では、一覧の中だけをスクロールし（ページ全体は引っ張らない）、
 * 退出のボタンは一覧の外（下）に固定する。
 *
 * 各行の details（表示用の補助。例: 役割・結果・状態）は、あるときだけ「キー 値」で並べる
 * （issue-42）。キーはゲームが画面に出す短い語として送るので、基盤は意味を知らずに出す。
 */

import type { GameManifest, PlayerId, RealtimeResult } from "@rondo/contracts";
import type { ReactNode } from "react";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";

export function ResultScreen({
	result,
	you,
	onLeave,
	game,
	fill = false,
	children,
}: {
	result: RealtimeResult;
	/** どのゲームの結果か（issue-69）。あれば、見出しの上に小さくロゴと名前を出す。 */
	game?: GameManifest;
	you: PlayerId | null;
	onLeave: () => void;
	/** 画面いっぱいの枠の中に置く（一覧の中だけスクロールし、ボタンを下に固定する）。 */
	fill?: boolean;
	children?: ReactNode;
}) {
	const ranked = [...result.rankings].sort((a, b) => a.rank - b.rank);

	return (
		<section
			className={
				fill
					? "flex min-h-0 w-full flex-1 flex-col items-center gap-3 px-6 pt-3 pb-3"
					: "flex w-full flex-col items-center gap-5"
			}
			data-testid="result-screen"
		>
			{game !== undefined ? (
				<p
					className="flex items-center gap-2 text-slate-300 text-sm"
					data-testid="result-game"
					data-game={game.id}
				>
					<GameLogo manifest={game} size={24} />
					{displayName(game)}
				</p>
			) : null}
			<h2 className="font-bold text-2xl text-white">結果発表</h2>

			{children}

			<ol
				className={
					fill
						? "flex min-h-0 w-full max-w-xs flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
						: "flex w-full max-w-xs flex-col gap-2"
				}
				data-testid="result-list"
			>
				{ranked.map((entry) => {
					const details = Object.entries(entry.result.details ?? {});
					return (
						<li
							key={entry.playerId}
							className="flex shrink-0 flex-col gap-1 rounded-xl bg-slate-800 px-4 py-3"
						>
							<div className="flex items-center gap-3">
								<span className="w-10 shrink-0 font-bold text-indigo-400 text-lg">
									{entry.rank}位
								</span>
								<span className="text-white">{entry.name}</span>
								{entry.playerId === you && (
									<span className="text-indigo-400 text-xs">あなた</span>
								)}
							</div>
							{details.length > 0 && (
								<dl className="flex flex-wrap gap-x-3 gap-y-1 pl-13 text-slate-300 text-xs">
									{details.map(([key, value]) => (
										<div key={key} className="flex gap-1">
											<dt className="text-slate-500">{key}</dt>
											<dd>{value}</dd>
										</div>
									))}
								</dl>
							)}
						</li>
					);
				})}
			</ol>

			<button
				type="button"
				onClick={onLeave}
				data-testid="result-leave"
				className="w-full max-w-xs shrink-0 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white"
			>
				退出する
			</button>

			<p className="max-w-xs shrink-0 text-center text-slate-500 text-xs">
				この結果は保存されません（ADR 0019）。退出するとルームは解散します（ADR
				0017）。
			</p>
		</section>
	);
}
