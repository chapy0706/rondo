/**
 * ステージの通知から、床・壁・戸の箱の一覧を作る（issue-29c）。純粋関数で、three.js を使わない。
 * 描画（scene.ts）は、この一覧を色ごとにまとめて描くだけにする。
 *
 * - 床: 歩けるマスごとに薄い箱。上面が高さ 0。色はその場の代表色（palette.ts）
 * - 壁: 高さ 2.4 m・厚さ 0.1 m の箱を、境の線の中央に立てる。違う領域どうしの境（戸の一覧に
 *   無い）と、歩けるマスと歩けないマス・地図の外との境。隠れ側の体を、鬼から隠せる高さにする
 * - 襖: 鴨居と両脇の柱（枠）は、いつも描く。板（明るい生成り色）は、閉じているときだけ描く
 * - いつも閉じている戸: 壁と同じ色の板。いつも開いている戸: 何も描かない
 * - 囲む: 地図の端（東端・南端も）にも壁を立てる。歩けるマスの上に天井（下面が壁と同じ 2.4 m）。
 *   玄関の外へ出る辺の中央のマスは、いつも閉じた引き戸（壁と同じ色・材質の板）と枠（stageEnclosure.ts）
 * - ダミーの襖（dummyFusuma.ts）: 壁の一部を、本物の閉じた襖と同じ板・鴨居・柱にする（開けられない）。
 *   見分けるヒントとして、本物の閉じた襖の板にだけ、小さく暗い引き手を付ける
 * - 材質（平屋の材質で飾るとき / stageMaterials.ts）: 箱ごとに材質の鍵と、寄せる色（床はその場の
 *   代表色）、掛ける色（壁は木の板張りを暗くする WALL_MULTIPLY）、床の絵の原点（畳は部屋の隅）を持つ。
 *   色（color）は、材質の素材が無いときの色の箱に使う
 */

import { dummyFusumaEdges } from "./dummyFusuma";
import type { Cell, DoorKind, StageGrid } from "./stage";
import { edgeKey } from "./stage";
import { entranceDoorEdges } from "./stageEnclosure";
import {
	CEILING_MULTIPLY,
	SURFACE_MATERIALS,
	type StageMaterialKey,
	WALL_MULTIPLY,
	floorMaterial,
	roomCorners,
} from "./stageMaterials";

export type StageBoxKind =
	| "floor"
	| "ceiling"
	| "wall"
	| "fusuma"
	| "frame"
	| "fixed-door"
	| "entry-door"
	| "dummy-fusuma"
	| "hikite";

/** 箱。x・y・z は中心、width は x 方向、height は y 方向、depth は z 方向の大きさ（メートル）。 */
export interface StageBox {
	readonly kind: StageBoxKind;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly width: number;
	readonly height: number;
	readonly depth: number;
	/** "#rrggbb"（材質の素材が無いときの色）。 */
	readonly color: string;
	/** 材質の鍵（材質の素材があるとき）。 */
	readonly material: StageMaterialKey;
	/** 材質に寄せる色（"#rrggbb"。絵の平均色がこの色になる倍率を掛ける）。null なら寄せない。 */
	readonly tint: string | null;
	/** 材質の絵にそのまま掛ける色（"#rrggbb"）。null なら掛けない。寄せる色と一緒には使わない。 */
	readonly multiply: string | null;
	/** 床の絵の原点（世界の x・z）。床以外は世界の原点。 */
	readonly uvOrigin: { readonly x: number; readonly z: number };
}

const WORLD_ORIGIN = { x: 0, z: 0 } as const;

/** 床以外の箱の材質と、寄せる色。 */
function surfaceOf(
	kind: Exclude<StageBoxKind, "floor">,
): Pick<StageBox, "material" | "tint" | "multiply" | "uvOrigin"> {
	return {
		material: SURFACE_MATERIALS[kind],
		tint: null,
		multiply:
			kind === "wall" || kind === "entry-door" || kind === "hikite"
				? WALL_MULTIPLY
				: kind === "ceiling"
					? CEILING_MULTIPLY
					: null,
		uvOrigin: WORLD_ORIGIN,
	};
}

export const FLOOR_THICKNESS = 0.05;
/** 天井の板の厚さ（下面が WALL_HEIGHT）。 */
export const CEILING_THICKNESS = 0.05;
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
/** 天井（素材が無いときの色。土壁より暗い木の色）。 */
export const CEILING_COLOR = "#5a4a3c";
/** 引き手（本物の閉じた襖の板の端の、小さく暗い部品）。 */
export const HIKITE_COLOR = "#2b221b";
/** 引き手の大きさ（境に沿う向きの幅・高さ）と、床からの高さ、板の端（柱の内側）からの距離。 */
const HIKITE_WIDTH = 0.04;
const HIKITE_HEIGHT = 0.09;
const HIKITE_Y = 0.85;
const HIKITE_INSET = 0.1;

/** 床・壁・戸の箱の一覧。open は開いている襖の鍵（edgeKey）。 */
export function stageBoxes(
	grid: StageGrid,
	open: ReadonlySet<string>,
): StageBox[] {
	const boxes: StageBox[] = [];
	const size = grid.cellSize;
	const corners = roomCorners(grid);
	const entrance = entranceDoorEdges(grid);
	const dummies = dummyFusumaEdges(grid);
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const cell = { x, z };
			const floor = floorMaterial(grid, cell, corners);
			if (floor === null) continue;
			boxes.push({
				kind: "floor",
				x: grid.origin.x + (x + 0.5) * size,
				y: -FLOOR_THICKNESS / 2,
				z: grid.origin.z + (z + 0.5) * size,
				width: size,
				height: FLOOR_THICKNESS,
				depth: size,
				// 床の色は、その場の代表色（寄せる色と同じ）。
				color: floor.tint,
				material: floor.material,
				tint: floor.tint,
				multiply: null,
				uvOrigin: floor.origin,
			});
			boxes.push({
				kind: "ceiling",
				x: grid.origin.x + (x + 0.5) * size,
				y: WALL_HEIGHT + CEILING_THICKNESS / 2,
				z: grid.origin.z + (z + 0.5) * size,
				width: size,
				height: CEILING_THICKNESS,
				depth: size,
				color: CEILING_COLOR,
				...surfaceOf("ceiling"),
			});
		}
	}
	// 各マスの東（x+1）と南（z+1）の境、と、地図の西端・北端の境を1回ずつ見る。東端・南端の境は、
	// 端のマスの東・南（地図の外）として見る。
	for (let z = -1; z < grid.depth; z++) {
		for (let x = -1; x < grid.width; x++) {
			const here = { x, z };
			for (const there of [
				{ x: x + 1, z },
				{ x, z: z + 1 },
			]) {
				boxes.push(...edgeBoxes(grid, open, here, there, entrance, dummies));
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
	entrance: ReadonlySet<string>,
	dummies: ReadonlySet<string>,
): StageBox[] {
	const ra = grid.regionAt(a);
	const rb = grid.regionAt(b);
	if (ra === null && rb === null) return [];
	const key = edgeKey(a, b);
	const kind: DoorKind | undefined =
		ra !== null && rb !== null ? grid.doors.get(key) : undefined;
	if (kind === undefined) {
		if (entrance.has(key)) {
			return framed(grid, a, b, "entry-door", WALL_COLOR, true);
		}
		if (dummies.has(key)) {
			return framed(grid, a, b, "dummy-fusuma", FUSUMA_COLOR, true);
		}
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
			return framed(grid, a, b, "fusuma", FUSUMA_COLOR, !open.has(key));
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
		...surfaceOf(kind as Exclude<StageBoxKind, "floor">),
	};
}

/** 鴨居と両脇の柱（枠）と、板（showPanel のときだけ）。襖と、玄関の引き戸。 */
function framed(
	grid: StageGrid,
	a: Cell,
	b: Cell,
	panelKind: "fusuma" | "dummy-fusuma" | "entry-door",
	panelColor: string,
	showPanel: boolean,
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
			...surfaceOf("frame"),
		});
	}
	if (showPanel) {
		boxes.push(
			panel(grid, a, b, panelKind, FUSUMA_HEIGHT, FUSUMA_THICKNESS, panelColor),
		);
	}
	if (showPanel && panelKind === "fusuma") {
		// 引き手: 板の片方の端（柱の内側）、板を貫いて両面に少し出る。
		const along = grid.cellSize / 2 - POST_WIDTH - HIKITE_INSET;
		const depth = FUSUMA_THICKNESS + 0.012;
		boxes.push({
			kind: "hikite",
			x: line.alongX ? line.x + along : line.x,
			y: HIKITE_Y,
			z: line.alongX ? line.z : line.z + along,
			width: line.alongX ? HIKITE_WIDTH : depth,
			height: HIKITE_HEIGHT,
			depth: line.alongX ? depth : HIKITE_WIDTH,
			color: HIKITE_COLOR,
			...surfaceOf("hikite"),
		});
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
