/**
 * ステージの地図と、移動の規則（issue-29c / ADR 0042）。
 *
 * サーバーのステージの通知（VeryareStageNotice）と襖の通知（VeryareDoorsNotice）を、境で
 * 検証して読む。クライアントは骨格の写しを持たず、通知の地図だけを使う。
 *
 * 移動の規則は、サーバーの server/src/rondo_server/games/veryare/grid.gleam の移植で、
 * 同じ入力に同じ結果を返す（共有の見本 veryare-movement.json を両方のテストで通す）。
 * - 領域のあるマスだけが歩ける。同じ領域どうしの境は通れ、異なる領域どうしは壁
 * - 戸の一覧の境は、種類で決まる（襖は開いているときだけ、いつも開いている戸は通れ、
 *   いつも閉じている戸は通れない）
 * - 通れない境の手前（1/1000 マス）で止め、境に沿って滑らせる。マスの角をちょうど通るときは、
 *   両脇がどちらも通れるときだけ通す。角で止まったら、通れる側へ回り込むように滑らせる
 *
 * mirrorMove は、サーバーの game.move が移動の報告をどう扱うか（動かす・待機ルームの円に
 * 丸める・無視する）を再現する。クライアントは毎フレーム手元で動き、報告のたびにサーバーの
 * 結果を再現して、1 cm 以上ずれたら合わせる（reconcile）。サーバーが正。
 */

import type { VeryareOpenDoorEvent } from "@rondo/contracts";
import type { Phase, Point, Role, Space } from "./rules";
import { clampToWaitingRoom } from "./rules";

export interface Cell {
	readonly x: number;
	readonly z: number;
}

/** 隣り合う2マスの境。 */
export interface Edge {
	readonly a: Cell;
	readonly b: Cell;
}

export type DoorKind = "fusuma" | "always-open" | "always-closed";

export interface StageGrid {
	readonly cellSize: number;
	readonly origin: Point;
	readonly width: number;
	readonly depth: number;
	/** z の順の行。各行は x の順の文字。 */
	readonly rows: readonly (readonly string[])[];
	/** 文字 → 領域の名前（歩けるマスの文字だけ）。 */
	readonly regions: Readonly<Record<string, string>>;
	/** 部屋のスロットの文字 → 部屋タイプ。 */
	readonly rooms: Readonly<Record<string, string>>;
	/** 境（edgeKey）→ 戸の種類。 */
	readonly doors: ReadonlyMap<string, DoorKind>;
	/** 戸の一覧（通知の順）。 */
	readonly doorList: readonly (Edge & { readonly kind: DoorKind })[];
	readonly spawn: Point;
	/** マスの領域。歩けないマスは null。 */
	regionAt(cell: Cell): string | null;
	/** マスの文字。地図の外は null。 */
	charAt(cell: Cell): string | null;
}

/** 襖を開けられる距離（メートル。サーバーの game.door_reach と同じ）。 */
export const DOOR_REACH = 1.5;

/** サーバーの位置とのずれを合わせる閾値（メートル）。 */
export const RECONCILE_TOLERANCE = 0.01;

const KINDS: readonly DoorKind[] = ["fusuma", "always-open", "always-closed"];

/** 境の鍵（向きを問わない）。小さいマスが先。 */
export function edgeKey(a: Cell, b: Cell): string {
	const [p, q] = a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
	return `${p.x},${p.z}|${q.x},${q.z}`;
}

// --- 通知を読む --------------------------------------------------------------------

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

function isCell(value: unknown): value is Cell {
	return isRecord(value) && isInt(value.x) && isInt(value.z);
}

function isAdjacent(a: Cell, b: Cell): boolean {
	return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;
}

function readEdge(value: unknown): Edge | null {
	if (!isRecord(value) || !isCell(value.a) || !isCell(value.b)) return null;
	if (!isAdjacent(value.a, value.b)) return null;
	return {
		a: { x: value.a.x, z: value.a.z },
		b: { x: value.b.x, z: value.b.z },
	};
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) && Object.values(value).every((v) => typeof v === "string")
	);
}

/** ステージの通知を読む。形が違えば null（境での検証）。 */
export function parseStageNotice(payload: unknown): StageGrid | null {
	if (!isRecord(payload) || payload.type !== "stage") return null;
	const { cellSize, origin, width, depth, rows, regions, rooms, doors, spawn } =
		payload;
	if (typeof cellSize !== "number" || cellSize <= 0) return null;
	if (!isInt(width) || !isInt(depth) || width <= 0 || depth <= 0) return null;
	if (!isPoint(origin) || !isPoint(spawn)) return null;
	if (!Array.isArray(rows) || rows.length !== depth) return null;
	const chars: string[][] = [];
	for (const row of rows) {
		if (typeof row !== "string") return null;
		const letters = [...row];
		if (letters.length !== width) return null;
		chars.push(letters);
	}
	if (!isStringRecord(regions) || !isStringRecord(rooms)) return null;
	if (!Array.isArray(doors)) return null;
	const doorList: (Edge & { kind: DoorKind })[] = [];
	const doorMap = new Map<string, DoorKind>();
	for (const door of doors) {
		const edge = readEdge(door);
		if (edge === null || !isRecord(door)) return null;
		const kind = KINDS.find((k) => k === door.kind);
		if (kind === undefined) return null;
		doorList.push({ ...edge, kind });
		doorMap.set(edgeKey(edge.a, edge.b), kind);
	}
	const charAt = (cell: Cell): string | null =>
		cell.x < 0 || cell.z < 0 ? null : (chars[cell.z]?.[cell.x] ?? null);
	return {
		cellSize,
		origin: { x: origin.x, z: origin.z },
		width,
		depth,
		rows: chars,
		regions,
		rooms,
		doors: doorMap,
		doorList,
		spawn: { x: spawn.x, z: spawn.z },
		charAt,
		regionAt: (cell) => {
			const char = charAt(cell);
			return char === null ? null : (regions[char] ?? null);
		},
	};
}

/** 襖の通知を読む。開いている襖の鍵（edgeKey）の集合。形が違えば null。 */
export function parseDoorsNotice(payload: unknown): Set<string> | null {
	if (!isRecord(payload) || payload.type !== "doors") return null;
	if (!Array.isArray(payload.open)) return null;
	const open = new Set<string>();
	for (const value of payload.open) {
		const edge = readEdge(value);
		if (edge === null) return null;
		open.add(edgeKey(edge.a, edge.b));
	}
	return open;
}

// --- 移動の規則（grid.gleam の移植） -----------------------------------------------

/** 点が入っているマス。 */
export function cellAt(grid: StageGrid, p: Point): Cell {
	return {
		x: Math.floor((p.x - grid.origin.x) / grid.cellSize),
		z: Math.floor((p.z - grid.origin.z) / grid.cellSize),
	};
}

/** 隣り合う2マスの境を越えられるか。open は開いている襖の鍵。 */
export function passable(
	grid: StageGrid,
	open: ReadonlySet<string>,
	a: Cell,
	b: Cell,
): boolean {
	const ra = grid.regionAt(a);
	const rb = grid.regionAt(b);
	if (ra === null || rb === null) return false;
	const key = edgeKey(a, b);
	const kind = grid.doors.get(key);
	if (kind === "fusuma") return open.has(key);
	if (kind === "always-open") return true;
	if (kind === "always-closed") return false;
	return ra === rb;
}

const MAX_SLIDES = 2;
const BACK_OFF = 0.001;
const SAME_TIME = 1e-9;
const NEVER = 1e18;

type Blocked =
	| { readonly kind: "x" }
	| { readonly kind: "z" }
	| { readonly kind: "both"; readonly xOpen: boolean; readonly zOpen: boolean };

type Walk =
	| { readonly arrived: true }
	| {
			readonly arrived: false;
			readonly cell: Cell;
			readonly t: number;
			readonly axis: Blocked;
	  };

function sign(value: number): number {
	return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function delta(d: number): number {
	return d === 0 ? NEVER : 1 / Math.abs(d);
}

function firstBoundary(start: number, d: number, index: number): number {
	const s = sign(d);
	if (s > 0) return (index + 1 - start) / d;
	if (s < 0) return (index - start) / d;
	return NEVER;
}

function inside(index: number, direction: number): number {
	return direction > 0 ? index + 1 - BACK_OFF : index + BACK_OFF;
}

/** from から to へ動く（サーバーの grid.step と同じ）。from が歩けるマスでなければ動かない。 */
export function stepOnGrid(
	grid: StageGrid,
	open: ReadonlySet<string>,
	from: Point,
	to: Point,
): Point {
	return travel(grid, open, from, to, MAX_SLIDES);
}

function travel(
	grid: StageGrid,
	open: ReadonlySet<string>,
	from: Point,
	to: Point,
	slides: number,
): Point {
	const start = cellAt(grid, from);
	if (grid.regionAt(start) === null) return from;
	const u0 = (from.x - grid.origin.x) / grid.cellSize;
	const v0 = (from.z - grid.origin.z) / grid.cellSize;
	const du = (to.x - grid.origin.x) / grid.cellSize - u0;
	const dv = (to.z - grid.origin.z) / grid.cellSize - v0;
	const stepX = sign(du);
	const stepZ = sign(dv);
	const walked = walk(
		grid,
		open,
		start,
		stepX,
		stepZ,
		firstBoundary(u0, du, start.x),
		firstBoundary(v0, dv, start.z),
		delta(du),
		delta(dv),
	);
	if (walked.arrived) return to;
	const { cell, t, axis } = walked;
	const u = axis.kind === "z" ? u0 + du * t : inside(cell.x, stepX);
	const v = axis.kind === "x" ? v0 + dv * t : inside(cell.z, stepZ);
	const stop = {
		x: grid.origin.x + u * grid.cellSize,
		z: grid.origin.z + v * grid.cellSize,
	};
	return slide(grid, open, stop, to, axis, slides);
}

function slide(
	grid: StageGrid,
	open: ReadonlySet<string>,
	stop: Point,
	to: Point,
	axis: Blocked,
	slides: number,
): Point {
	const restX = to.x - stop.x;
	const restZ = to.z - stop.z;
	let target: Point;
	if (axis.kind === "x") target = { x: stop.x, z: to.z };
	else if (axis.kind === "z") target = { x: to.x, z: stop.z };
	else if (axis.xOpen && !axis.zOpen) target = { x: to.x, z: stop.z };
	else if (!axis.xOpen && axis.zOpen) target = { x: stop.x, z: to.z };
	else
		target =
			Math.abs(restX) >= Math.abs(restZ)
				? { x: to.x, z: stop.z }
				: { x: stop.x, z: to.z };
	if (slides <= 0 || (target.x === stop.x && target.z === stop.z)) return stop;
	return travel(grid, open, stop, target, slides - 1);
}

function walk(
	grid: StageGrid,
	open: ReadonlySet<string>,
	startCell: Cell,
	stepX: number,
	stepZ: number,
	startTx: number,
	startTz: number,
	deltaX: number,
	deltaZ: number,
): Walk {
	let cell = startCell;
	let tx = startTx;
	let tz = startTz;
	for (;;) {
		if (tx >= 1 && tz >= 1) return { arrived: true };
		if (Math.abs(tx - tz) < SAME_TIME) {
			const sideX = { x: cell.x + stepX, z: cell.z };
			const sideZ = { x: cell.x, z: cell.z + stepZ };
			const corner = { x: cell.x + stepX, z: cell.z + stepZ };
			const xOpen = passable(grid, open, cell, sideX);
			const zOpen = passable(grid, open, cell, sideZ);
			if (
				xOpen &&
				passable(grid, open, sideX, corner) &&
				zOpen &&
				passable(grid, open, sideZ, corner)
			) {
				cell = corner;
				tx += deltaX;
				tz += deltaZ;
				continue;
			}
			return {
				arrived: false,
				cell,
				t: tx,
				axis: { kind: "both", xOpen, zOpen },
			};
		}
		if (tx < tz) {
			const next = { x: cell.x + stepX, z: cell.z };
			if (!passable(grid, open, cell, next)) {
				return { arrived: false, cell, t: tx, axis: { kind: "x" } };
			}
			cell = next;
			tx += deltaX;
		} else {
			const next = { x: cell.x, z: cell.z + stepZ };
			if (!passable(grid, open, cell, next)) {
				return { arrived: false, cell, t: tz, axis: { kind: "z" } };
			}
			cell = next;
			tz += deltaZ;
		}
	}
}

/** 点から境（2マスが接する辺の線分）までの距離（サーバーの grid.distance_to_edge と同じ）。 */
export function distanceToEdge(grid: StageGrid, edge: Edge, p: Point): number {
	const { a, b } = edge;
	const [start, end] =
		a.x === b.x
			? [
					{ x: a.x, z: Math.max(a.z, b.z) },
					{ x: a.x + 1, z: Math.max(a.z, b.z) },
				]
			: [
					{ x: Math.max(a.x, b.x), z: a.z },
					{ x: Math.max(a.x, b.x), z: a.z + 1 },
				];
	const s = {
		x: grid.origin.x + start.x * grid.cellSize,
		z: grid.origin.z + start.z * grid.cellSize,
	};
	const e = {
		x: grid.origin.x + end.x * grid.cellSize,
		z: grid.origin.z + end.z * grid.cellSize,
	};
	const dx = e.x - s.x;
	const dz = e.z - s.z;
	const t = Math.min(
		1,
		Math.max(0, ((p.x - s.x) * dx + (p.z - s.z) * dz) / (dx * dx + dz * dz)),
	);
	return Math.hypot(s.x + dx * t - p.x, s.z + dz * t - p.z);
}

// --- 襖を開けるボタン --------------------------------------------------------------

/**
 * 開けるボタンの対象の襖。動けて、ステージにいて、襖を開けられるフェーズ（準備移動・
 * ペイント・探索）のとき、閉じた襖の境から 1.5 m 以内の、いちばん近い襖。無ければ null。
 */
export function doorToOpen(options: {
	readonly grid: StageGrid;
	readonly open: ReadonlySet<string>;
	readonly phase: Phase;
	readonly movable: boolean;
	readonly space: Space;
	readonly position: Point;
}): Edge | null {
	const { grid, open, phase, movable, space, position } = options;
	if (!movable || space !== "stage") return null;
	if (
		phase !== "preparation" &&
		phase !== "painting" &&
		phase !== "exploration"
	) {
		return null;
	}
	let best: { edge: Edge; distance: number } | null = null;
	for (const door of grid.doorList) {
		if (door.kind !== "fusuma" || open.has(edgeKey(door.a, door.b))) continue;
		const distance = distanceToEdge(grid, door, position);
		if (distance > DOOR_REACH) continue;
		if (best === null || distance < best.distance) {
			best = { edge: { a: door.a, b: door.b }, distance };
		}
	}
	return best?.edge ?? null;
}

// --- サーバーの位置の再現 ------------------------------------------------------------

/**
 * サーバーの game.move が、移動の報告（to）をどう扱うかを再現する。from はサーバーが
 * 知っている今の位置。動けない（ペイント・探索の隠れ側、答え合わせ・終了の後）なら from の
 * まま。待機ルームは円に丸める。ステージは移動の規則で from から to へ動かす。
 */
export function mirrorMove(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly space: Space;
	readonly grid: StageGrid | null;
	readonly open: ReadonlySet<string>;
	readonly from: Point;
	readonly to: Point;
}): Point {
	const { phase, role, space, grid, open, from, to } = options;
	const canMove =
		phase === "oni-selection" || phase === "preparation"
			? true
			: phase === "painting" || phase === "exploration"
				? role === "oni"
				: false;
	if (!canMove) return from;
	if (space === "waiting-room") return clampToWaitingRoom(to);
	if (grid === null) return from;
	return stepOnGrid(grid, open, from, to);
}

/** 襖を開ける報告（契約の VeryareOpenDoorEvent）。 */
export function openDoorEvent(door: Edge): VeryareOpenDoorEvent {
	return { type: "open-door", door: { a: door.a, b: door.b } };
}

/** 手元の位置を、サーバーの位置と 1 cm 以上ずれていたら、サーバーの位置にする。 */
export function reconcile(local: Point, server: Point): Point {
	return Math.hypot(local.x - server.x, local.z - server.z) >=
		RECONCILE_TOLERANCE
		? server
		: local;
}
