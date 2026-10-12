/**
 * ランダム間取りのダミーの襖（見た目だけ。開けられない。サーバーは何も知らない）。three を使わない純粋関数。
 *
 * - 位置は、地図の中身（行の文字列と大きさ）から作る乱数の種で決める。同じ地図なら、全員の画面で同じ位置
 * - 置ける辺: 2 つの歩ける場所（違う領域）の間の壁（戸の一覧に無い辺）。本物の襖の辺と、同じ直線上で
 *   隣り合う辺には置かない。玄関（@）・縁側（=）に接する辺には置かない。ダミーどうしも、隣り合わせない
 * - 個数は DUMMY_FUSUMA_MIN〜DUMMY_FUSUMA_MAX（置ける辺が足りなければ、置けるだけ）
 * - 平屋のステージには置かない
 * - 見分けるヒント: 本物の閉じた襖には引き手を付け、ダミーには付けない（stageBoxes.ts）
 */

import { isHirayaStage } from "./hiraya";
import type { Cell, StageGrid } from "./stage";
import { edgeKey } from "./stage";
import { placeKind } from "./stageMaterials";

export const DUMMY_FUSUMA_MIN = 4;
export const DUMMY_FUSUMA_MAX = 6;

/** 地図の中身からの乱数の種（FNV-1a、32 ビット）。 */
export function mapSeed(grid: StageGrid): number {
	const text = `${grid.width}x${grid.depth}\n${grid.rows.map((row) => row.join("")).join("\n")}`;
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/** 種から決まる乱数（mulberry32。0 以上 1 未満）。 */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 同じ直線上で隣り合う2辺の鍵（a-b は隣り合う2マス）。 */
function neighborKeys(a: Cell, b: Cell): string[] {
	// a.x === b.x なら、z の向きに隣り合う2マスの境（x の向きに伸びる線）。
	const step = a.x === b.x ? { x: 1, z: 0 } : { x: 0, z: 1 };
	return [-1, 1].map((s) =>
		edgeKey(
			{ x: a.x + s * step.x, z: a.z + s * step.z },
			{ x: b.x + s * step.x, z: b.z + s * step.z },
		),
	);
}

/** ダミーの襖を置く辺（edgeKey）。並びは選んだ順。 */
export function dummyFusumaEdges(grid: StageGrid): Set<string> {
	if (isHirayaStage(grid)) return new Set();
	const blocked = new Set<string>();
	for (const door of grid.doorList) {
		blocked.add(edgeKey(door.a, door.b));
		for (const key of neighborKeys(door.a, door.b)) blocked.add(key);
	}
	const candidates: [Cell, Cell][] = [];
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const a = { x, z };
			for (const b of [
				{ x: x + 1, z },
				{ x, z: z + 1 },
			]) {
				const ra = grid.regionAt(a);
				const rb = grid.regionAt(b);
				if (ra === null || rb === null || ra === rb) continue;
				if (blocked.has(edgeKey(a, b))) continue;
				const kinds = [placeKind(grid, a), placeKind(grid, b)];
				if (kinds.includes("genkan") || kinds.includes("engawa")) continue;
				candidates.push([a, b]);
			}
		}
	}
	const next = random(mapSeed(grid));
	// 候補を、種から決まる順に並べ替える（Fisher-Yates）。
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[candidates[i], candidates[j]] = [
			candidates[j] as [Cell, Cell],
			candidates[i] as [Cell, Cell],
		];
	}
	const count =
		DUMMY_FUSUMA_MIN +
		Math.floor(next() * (DUMMY_FUSUMA_MAX - DUMMY_FUSUMA_MIN + 1));
	const chosen = new Set<string>();
	const near = new Set<string>();
	for (const [a, b] of candidates) {
		if (chosen.size >= count) break;
		const key = edgeKey(a, b);
		if (near.has(key)) continue;
		chosen.add(key);
		for (const neighbor of neighborKeys(a, b)) near.add(neighbor);
	}
	return chosen;
}
