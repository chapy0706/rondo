/**
 * ステージの通知から、床・壁・戸の箱の一覧を作る（issue-29c）。純粋関数で、three.js を使わない。
 * 描画（scene.ts）は、この一覧を色ごとにまとめて描くだけにする。
 *
 * - 床: 歩けるマスごとに薄い箱。上面が高さ 0。色はその場の代表色（palette.ts）
 * - 壁: 高さ 2.4 m・厚さ 0.1 m の箱を、境の線の中央に立てる。違う領域どうしの境（戸の一覧に
 *   無い）と、歩けるマスと歩けないマス・地図の外との境。隠れ側の体を、鬼から隠せる高さにする
 * - 襖: 鴨居と両脇の柱（枠）は、いつも描く。板（明るい生成り色）は、閉じているときだけ描く
 * - いつも閉じている戸: 壁と同じ色の板。いつも開いている戸: 何も描かない
 */

import { placeColor } from "./palette";
import type { Cell, DoorKind, StageGrid } from "./stage";
import { edgeKey } from "./stage";

export type StageBoxKind = "floor" | "wall" | "fusuma" | "frame" | "fixed-door";

/** 箱。x・y・z は中心、width は x 方向、height は y 方向、depth は z 方向の大きさ（メートル）。 */
export interface StageBox {
	readonly kind: StageBoxKind;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly width: number;
	readonly height: number;
	readonly depth: number;
	/** "#rrggbb"。 */
	readonly color: string;
}

export const FLOOR_THICKNESS = 0.05;
export const WALL_HEIGHT = 2.4;
export const WALL_THICKNESS = 0.1;
/** 襖の板の高さ（その上は鴨居）。 */
export const FUSUMA_HEIGHT = 1.8;
const FUSUMA_THICKNESS = 0.06;
/** 襖の両脇の柱の幅（境に沿う向き）と厚さ。 */
const POST_WIDTH = 0.06;
const POST_THICKNESS = 0.14;

/** 土壁（くすんだ灰茶）。 */
export const WALL_COLOR = "#7a6a58";
/** 襖の板（明るい生成り色）。壁と見分けられるよう、明るさを大きく変える。 */
export const FUSUMA_COLOR = "#f2ead6";
/** 襖の枠（鴨居と柱。濃い木の色）。 */
export const FRAME_COLOR = "#3e2c1e";

/** 床・壁・戸の箱の一覧。open は開いている襖の鍵（edgeKey）。 */
export function stageBoxes(
	grid: StageGrid,
	open: ReadonlySet<string>,
): StageBox[] {
	const boxes: StageBox[] = [];
	const size = grid.cellSize;
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const cell = { x, z };
			if (grid.regionAt(cell) === null) continue;
			boxes.push({
				kind: "floor",
				x: grid.origin.x + (x + 0.5) * size,
				y: -FLOOR_THICKNESS / 2,
				z: grid.origin.z + (z + 0.5) * size,
				width: size,
				height: FLOOR_THICKNESS,
				depth: size,
				color: placeColor(grid, cell),
			});
		}
	}
	// 各マスの東（x+1）と南（z+1）の境、と、地図の西端・北端の境を1回ずつ見る。
	for (let z = -1; z < grid.depth; z++) {
		for (let x = -1; x < grid.width; x++) {
			const here = { x, z };
			for (const there of [
				{ x: x + 1, z },
				{ x, z: z + 1 },
			]) {
				if (there.x >= grid.width || there.z >= grid.depth) continue;
				boxes.push(...edgeBoxes(grid, open, here, there));
			}
		}
	}
	return boxes;
}

function edgeBoxes(
	grid: StageGrid,
	open: ReadonlySet<string>,
	a: Cell,
	b: Cell,
): StageBox[] {
	const ra = grid.regionAt(a);
	const rb = grid.regionAt(b);
	if (ra === null && rb === null) return [];
	const key = edgeKey(a, b);
	const kind: DoorKind | undefined =
		ra !== null && rb !== null ? grid.doors.get(key) : undefined;
	if (kind === undefined) {
		return ra === rb
			? []
			: [panel(grid, a, b, "wall", WALL_HEIGHT, WALL_THICKNESS, WALL_COLOR)];
	}
	switch (kind) {
		case "always-open":
			return [];
		case "always-closed":
			return [
				panel(
					grid,
					a,
					b,
					"fixed-door",
					WALL_HEIGHT,
					WALL_THICKNESS,
					WALL_COLOR,
				),
			];
		case "fusuma":
			return fusuma(grid, a, b, open.has(key));
	}
}

/** 境の線の中央に立つ、床から height までの板。 */
function panel(
	grid: StageGrid,
	a: Cell,
	b: Cell,
	kind: StageBoxKind,
	height: number,
	thickness: number,
	color: string,
): StageBox {
	const line = edgeLine(grid, a, b);
	return {
		kind,
		x: line.x,
		y: height / 2,
		z: line.z,
		width: line.alongX ? grid.cellSize : thickness,
		height,
		depth: line.alongX ? thickness : grid.cellSize,
		color,
	};
}

function fusuma(
	grid: StageGrid,
	a: Cell,
	b: Cell,
	isOpen: boolean,
): StageBox[] {
	const line = edgeLine(grid, a, b);
	const lintelHeight = WALL_HEIGHT - FUSUMA_HEIGHT;
	const boxes: StageBox[] = [
		{
			...panel(grid, a, b, "frame", lintelHeight, WALL_THICKNESS, FRAME_COLOR),
			y: FUSUMA_HEIGHT + lintelHeight / 2,
		},
	];
	const half = grid.cellSize / 2 - POST_WIDTH / 2;
	for (const side of [-1, 1]) {
		boxes.push({
			kind: "frame",
			x: line.alongX ? line.x + side * half : line.x,
			y: FUSUMA_HEIGHT / 2,
			z: line.alongX ? line.z : line.z + side * half,
			width: line.alongX ? POST_WIDTH : POST_THICKNESS,
			height: FUSUMA_HEIGHT,
			depth: line.alongX ? POST_THICKNESS : POST_WIDTH,
			color: FRAME_COLOR,
		});
	}
	if (!isOpen) {
		boxes.push(
			panel(
				grid,
				a,
				b,
				"fusuma",
				FUSUMA_HEIGHT,
				FUSUMA_THICKNESS,
				FUSUMA_COLOR,
			),
		);
	}
	return boxes;
}

/** 境の線の中央と、線の向き（alongX: x 方向に伸びる線 = z 方向に隣り合う2マスの境）。 */
function edgeLine(
	grid: StageGrid,
	a: Cell,
	b: Cell,
): { x: number; z: number; alongX: boolean } {
	const size = grid.cellSize;
	if (a.x === b.x) {
		return {
			x: grid.origin.x + (a.x + 0.5) * size,
			z: grid.origin.z + Math.max(a.z, b.z) * size,
			alongX: true,
		};
	}
	return {
		x: grid.origin.x + Math.max(a.x, b.x) * size,
		z: grid.origin.z + (a.z + 0.5) * size,
		alongX: false,
	};
}
