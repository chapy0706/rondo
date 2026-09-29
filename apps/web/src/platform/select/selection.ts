import type { GameManifest } from "@rondo/contracts";

/** ソロ / リアルタイムの別を、選ぶ人向けの言葉で表す。 */
const kindLabel: Record<GameManifest["kind"], string> = {
	solo: "ひとり",
	realtime: "みんな",
};

/** 遊び方と人数。ソロは単一人数、リアルタイムは範囲。 */
export function playerLabel(manifest: GameManifest): string {
	const players =
		manifest.minPlayers === manifest.maxPlayers
			? `${manifest.minPlayers}人`
			: `${manifest.minPlayers}〜${manifest.maxPlayers}人`;
	return `${kindLabel[manifest.kind]} ${players}`;
}

/** サムネイルが無いときにカードへ大きく描く頭文字。 */
export function fallbackInitial(manifest: GameManifest): string {
	const [first] = Array.from(manifest.title.trim());
	return first === undefined ? "?" : first.toUpperCase();
}

/** シェルフの中心に最も近いカードの位置。等距離なら手前を選ぶ。 */
export function nearestIndex(
	cardCenters: readonly number[],
	viewportCenter: number,
): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	cardCenters.forEach((center, i) => {
		const distance = Math.abs(center - viewportCenter);
		if (distance < bestDistance) {
			best = i;
			bestDistance = distance;
		}
	});
	return best;
}
