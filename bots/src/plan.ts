/**
 * 襖と射撃の見通しを確かめるシナリオ（issue-29b）の、マスの選び方と道の探し方。
 * どちらも純粋関数で、ステージの通知（stage.ts の StageMap）だけを使う。
 *
 * - findPath: 通れる境だけをたどる幅優先探索。襖は、開いている扱い（"open"）か、閉じている
 *   扱い（"closed"）かを選ぶ。いつも開いている戸はいつも通れ、いつも閉じている戸と壁は通れない
 * - pickDoorShot: 割り当てられた部屋を1つ選び、次の4つのマスを決める
 *   - c: 部屋の襖の、廊下側のマス / s: 同じ襖の、部屋側のマス
 *   - r: 同じ部屋の、s とは別のマスで、廊下と壁で接しているマス / w: その壁の向こうの廊下のマス
 *   w から r へ撃つと、壁の境だけを越える。c から s へ撃つと、襖の境だけを越える
 *   （どちらも 1 m 先で、射程の内側）。隠れ側は襖が開いている準備移動の間に s・r へ、鬼は
 *   襖が閉じた探索の間に c・w へ、玄関から着けること
 */

import type { Point, StageMap } from "./stage.ts";

export interface Cell {
	readonly x: number;
	readonly z: number;
}

export interface DoorShotPlan {
	readonly room: string;
	readonly door: { readonly a: Cell; readonly b: Cell };
	readonly c: Cell;
	readonly s: Cell;
	readonly r: Cell;
	readonly w: Cell;
}

/** 襖の扱い。"open" は全部開いている、"closed" は全部閉じている。 */
export type DoorState = "open" | "closed";

const NEIGHBORS: readonly Cell[] = [
	{ x: 1, z: 0 },
	{ x: -1, z: 0 },
	{ x: 0, z: 1 },
	{ x: 0, z: -1 },
];

/** 点が入っているマス。 */
export function cellOf(stage: StageMap, p: Point): Cell {
	return {
		x: Math.floor((p.x - stage.origin.x) / stage.cellSize),
		z: Math.floor((p.z - stage.origin.z) / stage.cellSize),
	};
}

/** マスの中心の座標。 */
export function centerOf(stage: StageMap, cell: Cell): Point {
	return {
		x: stage.origin.x + (cell.x + 0.5) * stage.cellSize,
		z: stage.origin.z + (cell.z + 0.5) * stage.cellSize,
	};
}

/** マスの領域。歩けないマスは null。 */
export function regionAt(stage: StageMap, cell: Cell): string | null {
	if (cell.x < 0 || cell.z < 0) return null;
	const char = [...(stage.rows[cell.z] ?? "")][cell.x];
	if (char === undefined) return null;
	return stage.regions[char] ?? null;
}

function edgeKey(a: Cell, b: Cell): string {
	const [p, q] = a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
	return `${p.x},${p.z}|${q.x},${q.z}`;
}

/** 隣り合う2マスの境を越えられるか（サーバーの grid.passable と同じ規則）。 */
export function passable(
	stage: StageMap,
	a: Cell,
	b: Cell,
	doors: DoorState,
): boolean {
	const ra = regionAt(stage, a);
	const rb = regionAt(stage, b);
	if (ra === null || rb === null) return false;
	const kind = stage.doors.get(edgeKey(a, b));
	if (kind === undefined) return ra === rb;
	if (kind === "always-open") return true;
	if (kind === "fusuma") return doors === "open";
	return false;
}

/** from から to への最短の道（両端を含む）。着けなければ null。 */
export function findPath(
	stage: StageMap,
	from: Cell,
	to: Cell,
	doors: DoorState,
): Cell[] | null {
	if (regionAt(stage, from) === null) return null;
	const key = (c: Cell) => `${c.x},${c.z}`;
	const previous = new Map<string, Cell | null>([[key(from), null]]);
	const queue: Cell[] = [from];
	while (queue.length > 0) {
		const here = queue.shift() as Cell;
		if (here.x === to.x && here.z === to.z) {
			const path: Cell[] = [];
			let cell: Cell | null = here;
			while (cell !== null) {
				path.unshift(cell);
				cell = previous.get(key(cell)) ?? null;
			}
			return path;
		}
		for (const d of NEIGHBORS) {
			const next = { x: here.x + d.x, z: here.z + d.z };
			if (previous.has(key(next))) continue;
			if (!passable(stage, here, next, doors)) continue;
			previous.set(key(next), here);
			queue.push(next);
		}
	}
	return null;
}

/**
 * 襖越し・壁越しに撃つためのマスを選ぶ。部屋は文字の順、襖は通知の順、r はマスの並び
 * （z、x の順）で、最初に条件を満たすものにする（同じ地図なら、いつも同じ結果）。
 */
export function pickDoorShot(stage: StageMap): DoorShotPlan | null {
	const spawn = cellOf(stage, stage.spawn);
	const rooms = Object.entries(stage.regions)
		.filter(([, region]) => region !== "open")
		.map(([, region]) => region)
		.filter((region, i, all) => all.indexOf(region) === i)
		.sort();
	const cells: Cell[] = [];
	for (let z = 0; z < stage.depth; z++) {
		for (let x = 0; x < stage.width; x++) cells.push({ x, z });
	}
	for (const room of rooms) {
		const roomCells = cells.filter((cell) => regionAt(stage, cell) === room);
		for (const [key, kind] of stage.doors) {
			if (kind !== "fusuma") continue;
			const [a, b] = key.split("|").map((part) => {
				const [x, z] = part.split(",").map(Number);
				return { x: x as number, z: z as number };
			}) as [Cell, Cell];
			const s = regionAt(stage, a) === room ? a : b;
			const c = s === a ? b : a;
			if (regionAt(stage, s) !== room || regionAt(stage, c) !== "open")
				continue;
			if (findPath(stage, spawn, c, "closed") === null) continue;
			if (findPath(stage, spawn, s, "open") === null) continue;
			for (const r of roomCells) {
				if (r.x === s.x && r.z === s.z) continue;
				for (const d of NEIGHBORS) {
					const w = { x: r.x + d.x, z: r.z + d.z };
					if (regionAt(stage, w) !== "open") continue;
					if (stage.doors.has(edgeKey(w, r))) continue;
					if (findPath(stage, spawn, w, "closed") === null) continue;
					if (findPath(stage, spawn, r, "open") === null) continue;
					return { room, door: { a, b }, c, s, r, w };
				}
			}
		}
	}
	return null;
}
