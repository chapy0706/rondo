/**
 * ボットが使う、ステージの通知（issue-29a / 契約: VeryareStageNotice）の読み方と、
 * 隠れ側を別々の場所へ動かすための場所の選び方。
 *
 * 全員が玄関に現れる（ADR 0032）ので、隠れ側のボットは準備移動の間に別々の場所へ動く。
 * 場所は、玄関のマスから上下左右へ、通れる境だけを一直線にたどれるマスを近い順に並べ、
 * 玄関とも互いとも 0.8 m 以上離れたものを選ぶ。一直線なので、サーバーの移動の規則で
 * そのまま着く。選び方は、サーバーのテストの補助（server/test/.../veryare/spread.gleam）と同じ。
 */

import type { VeryareStageNotice } from "@rondo/contracts";

export interface Point {
	readonly x: number;
	readonly z: number;
}

/** 読んだ地図。 */
export interface StageMap {
	readonly cellSize: number;
	readonly origin: Point;
	readonly width: number;
	readonly depth: number;
	readonly rows: readonly string[];
	readonly regions: Readonly<Record<string, string>>;
	/** 境（"x,z|x,z"。小さいマスが先）→ 戸の種類。 */
	readonly doors: ReadonlyMap<string, string>;
	readonly spawn: Point;
}

/** 互いの距離の下限（メートル）。被り判定の直径 0.6 m に余裕を足す。 */
const MIN_GAP = 0.8;

const KINDS = new Set(["fusuma", "always-open", "always-closed"]);

/** ステージの通知（unknown）を読む。形が違えば null（境での検証）。 */
export function readStageNotice(value: unknown): StageMap | null {
	if (!isRecord(value) || value.type !== "stage") return null;
	const { cellSize, origin, width, depth, rows, regions, doors, spawn } =
		value as Partial<Record<keyof VeryareStageNotice, unknown>>;
	if (typeof cellSize !== "number" || cellSize <= 0) return null;
	if (!isInt(width) || !isInt(depth) || width <= 0 || depth <= 0) return null;
	if (!isPoint(origin) || !isPoint(spawn)) return null;
	if (!Array.isArray(rows) || rows.length !== depth) return null;
	if (
		!rows.every((row) => typeof row === "string" && [...row].length === width)
	)
		return null;
	if (!isRecord(regions)) return null;
	if (!Object.values(regions).every((v) => typeof v === "string")) return null;
	if (!Array.isArray(doors)) return null;
	const doorMap = new Map<string, string>();
	for (const door of doors) {
		if (!isRecord(door) || !isCell(door.a) || !isCell(door.b)) return null;
		if (typeof door.kind !== "string" || !KINDS.has(door.kind)) return null;
		if (Math.abs(door.a.x - door.b.x) + Math.abs(door.a.z - door.b.z) !== 1)
			return null;
		doorMap.set(edgeKey(door.a, door.b), door.kind);
	}
	return {
		cellSize,
		origin,
		width,
		depth,
		rows: rows as string[],
		regions: regions as Record<string, string>,
		doors: doorMap,
		spawn,
	};
}

/** 玄関から一直線にたどれる、別々の場所を count 個（maxDistance メートル以内）。 */
export function spreadSpots(
	stage: StageMap,
	count: number,
	maxDistance: number,
): Point[] {
	const start = cellAt(stage, stage.spawn);
	const directions: readonly Point[] = [
		{ x: 0, z: -1 },
		{ x: 1, z: 0 },
		{ x: -1, z: 0 },
		{ x: 0, z: 1 },
	];
	const lines = directions.map((d) => {
		const cells: Point[] = [];
		let cell = start;
		for (;;) {
			const next = { x: cell.x + d.x, z: cell.z + d.z };
			if (!passable(stage, cell, next)) break;
			cells.push(next);
			cell = next;
		}
		return cells;
	});
	const longest = Math.max(0, ...lines.map((cells) => cells.length));
	const ordered: Point[] = [];
	for (let k = 0; k < longest; k++) {
		directions.forEach((d, i) => {
			const cell = lines[i]?.[k];
			if (cell !== undefined) ordered.push(pointOf(stage, d, cell));
		});
	}
	const chosen: Point[] = [];
	for (const p of ordered) {
		if (distance(stage.spawn, p) > maxDistance) continue;
		if (distance(stage.spawn, p) < MIN_GAP) continue;
		if (chosen.some((q) => distance(p, q) < MIN_GAP)) continue;
		chosen.push(p);
	}
	return chosen.slice(0, count);
}

/** 隣り合う2マスの境を、襖が全部閉じているとして越えられるか（サーバーの grid と同じ）。 */
function passable(stage: StageMap, a: Point, b: Point): boolean {
	const ra = regionOf(stage, a);
	const rb = regionOf(stage, b);
	if (ra === null || rb === null) return false;
	const kind = stage.doors.get(edgeKey(a, b));
	if (kind === undefined) return ra === rb;
	return kind === "always-open";
}

function regionOf(stage: StageMap, cell: Point): string | null {
	const char = [...(stage.rows[cell.z] ?? "")][cell.x];
	if (char === undefined || cell.x < 0) return null;
	return stage.regions[char] ?? null;
}

function cellAt(stage: StageMap, p: Point): Point {
	return {
		x: Math.floor((p.x - stage.origin.x) / stage.cellSize),
		z: Math.floor((p.z - stage.origin.z) / stage.cellSize),
	};
}

/** 一直線に着ける位置: 動く向きのマスの中心と、もう一方は玄関のまま。 */
function pointOf(stage: StageMap, d: Point, cell: Point): Point {
	const center = (index: number, origin: number) =>
		origin + (index + 0.5) * stage.cellSize;
	return d.x === 0
		? { x: stage.spawn.x, z: center(cell.z, stage.origin.z) }
		: { x: center(cell.x, stage.origin.x), z: stage.spawn.z };
}

function edgeKey(a: Point, b: Point): string {
	const [first, second] =
		a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
	return `${first.x},${first.z}|${second.x},${second.z}`;
}

function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function isPoint(value: unknown): value is Point {
	return (
		isRecord(value) &&
		typeof value.x === "number" &&
		typeof value.z === "number"
	);
}

function isCell(value: unknown): value is Point {
	return isRecord(value) && isInt(value.x) && isInt(value.z);
}
