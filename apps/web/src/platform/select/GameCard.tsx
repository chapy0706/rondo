import type { GameManifest } from "@rondo/contracts";
import Link from "next/link";

/** ソロ / リアルタイムの別を、選ぶ人向けの言葉で表す。 */
const kindLabel: Record<GameManifest["kind"], string> = {
	solo: "ひとり",
	realtime: "みんな",
};

/** 参加人数を表示用にまとめる。ソロは単一人数、リアルタイムは範囲。 */
function playerRange(manifest: GameManifest): string {
	if (manifest.minPlayers === manifest.maxPlayers) {
		return `${manifest.minPlayers}人`;
	}
	return `${manifest.minPlayers}〜${manifest.maxPlayers}人`;
}

/**
 * ゲームカード。マニフェスト 1 件を選択肢として描く（ADR 0003）。
 *
 * このコンポーネントは特定のゲームを知らず、マニフェストの自己記述だけを読む。
 * サムネイルは背景画像として参照し、未配置でもフォールバック色で崩れない。
 * カードを押すとゲームホスト（/play/<id>）へ遷移する。
 */
export function GameCard({ manifest }: { manifest: GameManifest }) {
	return (
		<Link
			href={`/play/${manifest.id}`}
			className="flex flex-col overflow-hidden rounded-2xl bg-slate-800 transition-transform active:scale-[0.98]"
		>
			<div
				className="aspect-video bg-slate-700 bg-center bg-cover"
				style={{ backgroundImage: `url(${manifest.thumbnail})` }}
			/>
			<div className="flex flex-col gap-2 p-4">
				<div className="flex items-center justify-between gap-2">
					<h2 className="font-semibold text-lg text-white">{manifest.title}</h2>
					<span className="shrink-0 rounded-full bg-slate-700 px-2.5 py-0.5 font-medium text-slate-300 text-xs">
						{kindLabel[manifest.kind]} {playerRange(manifest)}
					</span>
				</div>
				<p className="text-slate-400 text-sm">{manifest.description}</p>
			</div>
		</Link>
	);
}
