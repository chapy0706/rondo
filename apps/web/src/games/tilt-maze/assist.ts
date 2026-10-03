/**
 * rolling の進み具合とお助け（issue-39）。画面から切り離した純粋な関数。
 *
 * - 通ったマス数: 隣のマスへ移るたびに数える（戻った分も数える）
 * - お助け: HINT_LIMIT 回目までは、今いるマスから次に進むべきマスを1つ示す。それを超えると
 *   「答えを見る」になり、押すと今いるマスからの最短経路を、画面が revealStep を呼ぶたびに
 *   1マスずつ示す。球は動かさない（物理はそのまま / issue-39 の確認事項）
 */

import { type Grid, type MazeCell, shortestPath } from "./maze";

/** お助けで次のマスを示す回数。これを超えると「答えを見る」になる。 */
export const HINT_LIMIT = 3;
/** 「答えを見る」で1マスずつ示す間隔（ミリ秒）。 */
export const REVEAL_INTERVAL_MS = 500;

export interface Progress {
	/** 球が今いるマス。 */
	readonly cell: MazeCell;
	/** 隣のマスへ移った回数。 */
	readonly steps: number;
	readonly hintsUsed: number;
	/** お助けで示している、次に進むべきマス。 */
	readonly hint: MazeCell | null;
	/** 「答えを見る」で示している最短経路と、示し終えたマスの数。 */
	readonly reveal: {
		readonly path: readonly MazeCell[];
		readonly shown: number;
	} | null;
}

function same(a: MazeCell, b: MazeCell): boolean {
	return a.cx === b.cx && a.cy === b.cy;
}

export function startProgress(start: MazeCell): Progress {
	return { cell: start, steps: 0, hintsUsed: 0, hint: null, reveal: null };
}

/** 球がマスに入った。違うマスなら1歩数え、示していたマスに着いたら印を消す。 */
export function moveTo(progress: Progress, cell: MazeCell): Progress {
	if (same(progress.cell, cell)) return progress;
	return {
		...progress,
		cell,
		steps: progress.steps + 1,
		hint:
			progress.hint !== null && same(progress.hint, cell)
				? null
				: progress.hint,
	};
}

/** お助けボタンの文言。 */
export function hintLabel(progress: Progress): string {
	const left = HINT_LIMIT - progress.hintsUsed;
	return left > 0 ? `お助け（あと ${left} 回）` : "答えを見る";
}

/** お助けを使った。答えを見ている間は何もしない。 */
export function askHint(
	progress: Progress,
	grid: Grid,
	goal: MazeCell,
): Progress {
	if (progress.reveal !== null) return progress;
	const path = shortestPath(grid, progress.cell, goal);
	if (path === null) return progress;
	if (progress.hintsUsed < HINT_LIMIT) {
		return {
			...progress,
			hintsUsed: progress.hintsUsed + 1,
			hint: path[1] ?? null,
		};
	}
	return {
		...progress,
		hintsUsed: progress.hintsUsed + 1,
		hint: null,
		reveal: { path, shown: 1 },
	};
}

/** 「答えを見る」の1歩。もう1マス示す。 */
export function revealStep(progress: Progress): Progress {
	const reveal = progress.reveal;
	if (reveal === null || reveal.shown >= reveal.path.length) return progress;
	return { ...progress, reveal: { ...reveal, shown: reveal.shown + 1 } };
}
