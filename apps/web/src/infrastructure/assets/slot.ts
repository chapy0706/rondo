/**
 * 仮の表示と本素材の、差し替えのタイミング（issue-43）。
 *
 * 読み込みはゲームの開始を待たせない。ゲームは仮の表示で先に始め、見た目が急に変わらない
 * 時点（待機ルームの間など）で take() を呼び、読み込めていれば本素材に差し替える。
 * 差し替えてよい時間が終わったら lock() を呼ぶ。それ以降に読み込めても、その回は差し替えない。
 * どの時点で take()・lock() を呼ぶかは、素材を使うゲームの側（issue-46・issue-25）が決める。
 */

import type { LoadResult } from "./loader";

export interface SwapSlot<T> {
	/** 今、差し替えてよい本素材。読み込めていない・失敗・lock 済みなら null。 */
	take(): T | null;
	/** 差し替えてよい時間を終える。 */
	lock(): void;
}

export function createSwapSlot<T>(
	pending: Promise<LoadResult<T>>,
): SwapSlot<T> {
	let ready: T | null = null;
	let locked = false;
	void pending.then((result) => {
		if (!locked && result.ok) ready = result.value;
	});
	return {
		take: () => (locked ? null : ready),
		lock: () => {
			locked = true;
			ready = null;
		},
	};
}
