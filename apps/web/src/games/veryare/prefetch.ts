/**
 * veryare のロビーを開いた時点の先読み（issue-46）。games/registry の prefetchForLobby から、遅延
 * 読み込みで呼ばれる。平屋の選択肢を出すとき（HIRAYA_ENABLED）だけ、平屋の glb を読み始める。
 */

import { gameAssets, prefetchLobbyAssets } from "./assetSlots";
import { devTrace } from "./assetTrace";
import { HIRAYA_ENABLED } from "./manifest";

/** 始めたか・始めなかった理由・失敗は、開発中だけ Console に出す（assetTrace.ts）。 */
export function prefetchForLobby(): void {
	if (!HIRAYA_ENABLED) {
		devTrace({ kind: "prefetch-skip", reason: "hiraya-disabled" });
		return;
	}
	try {
		prefetchLobbyAssets(HIRAYA_ENABLED, gameAssets());
		devTrace({ kind: "prefetch-start" });
	} catch (error) {
		devTrace({ kind: "prefetch-error", message: String(error) });
	}
}
