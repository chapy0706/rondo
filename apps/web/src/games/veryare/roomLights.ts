/**
 * 部屋の小さな灯り。灯りの数は一定（ROOM_LIGHT_COUNT）にして、体（自分）に近い部屋へ置き直す。
 * 数を変えないので、three のシェーダーを作り直さない。灯りは部屋（rooms にある領域）の中心の上に置く。
 * 純粋関数（three を使わない）。
 */

import type { StageGrid } from "./stage";

/** 同時に点ける部屋の灯りの数。 */
export const ROOM_LIGHT_COUNT = 4;

export interface Spot {
	readonly x: number;
	readonly z: number;
}

/** 部屋ごとの灯りの位置（その部屋のマスの中心の平均。世界の x・z）。並びは、部屋が最初に出てきた順。 */
export function roomLightSpots(grid: StageGrid): Spot[] {
	const sums = new Map<string, { x: number; z: number; n: number }>();
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const region = grid.regionAt({ x, z });
			if (region === null || grid.rooms[region] === undefined) continue;
			const sum = sums.get(region) ?? { x: 0, z: 0, n: 0 };
			sum.x += grid.origin.x + (x + 0.5) * grid.cellSize;
			sum.z += grid.origin.z + (z + 0.5) * grid.cellSize;
			sum.n += 1;
			sums.set(region, sum);
		}
	}
	return [...sums.values()].map((s) => ({ x: s.x / s.n, z: s.z / s.n }));
}

/** 近い順に、最大 n 個（同じ距離なら、先に出てきた順）。 */
export function nearestSpots(
	spots: readonly Spot[],
	at: Spot,
	n: number,
): Spot[] {
	return spots
		.map((spot, index) => ({
			spot,
			index,
			d: (spot.x - at.x) ** 2 + (spot.z - at.z) ** 2,
		}))
		.sort((p, q) => p.d - q.d || p.index - q.index)
		.slice(0, Math.max(0, n))
		.map((item) => item.spot);
}
