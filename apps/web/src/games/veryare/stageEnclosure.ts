/**
 * ランダム間取りを囲む（見えない境をなくす）。three を使わない純粋関数。
 *
 * - uncoveredEdges: 歩けるマスの4辺のうち、壁・戸のどれも描かれておらず、向こうへ歩いても行けない辺
 *   （見えない境）を返す。向こうが同じ領域の歩けるマス、またはいつも開いている戸でつながる歩けるマスなら、
 *   描かなくてよい。それ以外の辺には、壁・いつも閉じている戸・玄関の引き戸・襖（枠と板）のどれかの箱が、
 *   辺の上に要る
 * - entranceDoorEdges: 玄関（@）の外へ出る辺（地図の端に面した辺）の、中央のマス（幅が奇数なら 1 マス、
 *   偶数なら 2 マス）。ここに、いつも閉じた引き戸を置く（見た目だけ。歩けないのは、地図の外と同じ）
 */

import type { Cell, StageGrid } from "./stage";
import { edgeKey } from "./stage";
import type { StageBox } from "./stageBoxes";

const SIDES = [
	{ dx: 1, dz: 0 },
	{ dx: -1, dz: 0 },
	{ dx: 0, dz: 1 },
	{ dx: 0, dz: -1 },
] as const;

/** 辺の上に立つ箱の種類（床・天井は辺をふさがない）。 */
const EDGE_KINDS = new Set<StageBox["kind"]>([
	"wall",
	"fixed-door",
	"entry-door",
	"frame",
	"fusuma",
	"dummy-fusuma",
]);

const EPSILON = 1e-6;

/** 辺 a-b の上に、箱が1つでもあるか。 */
function covered(
	grid: StageGrid,
	boxes: readonly StageBox[],
	a: Cell,
	b: Cell,
): boolean {
	const size = grid.cellSize;
	// alongX: x の向きに伸びる線（z の向きに隣り合う2マスの境）。
	const alongX = a.x === b.x;
	const x = alongX
		? grid.origin.x + (a.x + 0.5) * size
		: grid.origin.x + Math.max(a.x, b.x) * size;
	const z = alongX
		? grid.origin.z + Math.max(a.z, b.z) * size
		: grid.origin.z + (a.z + 0.5) * size;
	return boxes.some(
		(box) =>
			EDGE_KINDS.has(box.kind) &&
			(alongX
				? Math.abs(box.z - z) < EPSILON && Math.abs(box.x - x) < size / 2
				: Math.abs(box.x - x) < EPSILON && Math.abs(box.z - z) < size / 2),
	);
}

/** 見えない境（歩けるマス a と、その隣 b）。無ければ空。 */
export function uncoveredEdges(
	grid: StageGrid,
	boxes: readonly StageBox[],
): { a: Cell; b: Cell }[] {
	const found: { a: Cell; b: Cell }[] = [];
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const a = { x, z };
			const ra = grid.regionAt(a);
			if (ra === null) continue;
			for (const { dx, dz } of SIDES) {
				const b = { x: x + dx, z: z + dz };
				const rb = grid.regionAt(b);
				if (rb !== null) {
					if (ra === rb) continue;
					if (grid.doors.get(edgeKey(a, b)) === "always-open") continue;
				}
				if (!covered(grid, boxes, a, b)) found.push({ a, b });
			}
		}
	}
	return found;
}

const outside = (grid: StageGrid, cell: Cell) =>
	cell.x < 0 || cell.z < 0 || cell.x >= grid.width || cell.z >= grid.depth;

/** 玄関の外へ出る辺のうち、引き戸を置く辺（edgeKey）。 */
export function entranceDoorEdges(grid: StageGrid): Set<string> {
	const doors = new Set<string>();
	for (const { dx, dz } of SIDES) {
		// 同じ向きの、地図の端に面した玄関のマスを、端の線ごと・続いている並びごとにまとめる。
		const runs: Cell[][] = [];
		const along = dx === 0 ? "x" : "z";
		const cells: Cell[] = [];
		for (let z = 0; z < grid.depth; z++) {
			for (let x = 0; x < grid.width; x++) {
				const cell = { x, z };
				if (grid.charAt(cell) !== "@") continue;
				if (outside(grid, { x: x + dx, z: z + dz })) cells.push(cell);
			}
		}
		cells.sort((p, q) =>
			along === "x" ? p.z - q.z || p.x - q.x : p.x - q.x || p.z - q.z,
		);
		for (const cell of cells) {
			const run = runs[runs.length - 1];
			const last = run?.[run.length - 1];
			const next =
				last !== undefined &&
				(along === "x"
					? last.z === cell.z && last.x + 1 === cell.x
					: last.x === cell.x && last.z + 1 === cell.z);
			if (run !== undefined && next) run.push(cell);
			else runs.push([cell]);
		}
		for (const run of runs) {
			const middle =
				run.length % 2 === 1
					? [(run.length - 1) / 2]
					: [run.length / 2 - 1, run.length / 2];
			for (const index of middle) {
				const cell = run[index];
				if (cell === undefined) continue;
				doors.add(edgeKey(cell, { x: cell.x + dx, z: cell.z + dz }));
			}
		}
	}
	return doors;
}
