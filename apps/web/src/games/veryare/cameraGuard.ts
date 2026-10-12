/**
 * カメラの守り（issue-46 の続き / ADR 0043）。地図の守り（体からカメラへの線を、体のいる領域の中に
 * 収める / cameraRig.ts）に、次の2つを足す。どれも three を使わない純粋な計算。
 *
 * - 家具: 目の位置からカメラの位置への線が、家具の箱にふさがれない、いちばん遠い水平の距離を使う
 *   （allowedCameraReach）。低い家具（線が箱の上を通る）は止めない。体の円柱が箱に重なるときは、その箱で
 *   止めない（体が家具に重なっていても、カメラが決まるように）
 * - 近くの面: カメラの位置を、領域の境（壁・すべての戸）から壁の余白（CAMERA_WALL_MARGIN。設定の wallMargin）、家具の箱から
 *   CAMERA_FURNITURE_MARGIN 以上、水平に離す（placeGuardedCamera）。どちらの余白も、ニアクリップの
 *   面の角までの距離（NEAR_CLEARANCE）より大きい。壁の面は、地図の格子の線から最大 WALL_FACE_OFFSET
 *   だけ部屋の側に出ている（実測）ので、壁の余白はその和より大きくする
 *
 * 縮むときは即座、伸びるときはなめらか（followCameraReach）は、呼び出し側でそのまま使う。
 */

import { BODY_HEIGHT, BODY_RADIUS } from "./bodySize";
import { type CameraSettings, DEFAULT_CAMERA, EYE_HEIGHT } from "./camera";
import {
	type ReachedPose,
	cameraReach,
	fullReach,
	reachedPose,
} from "./cameraRig";
import type { Cell, StageGrid } from "./stage";

interface P3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}
interface P2 {
	readonly x: number;
	readonly z: number;
}

/** 家具の箱（ワールドの座標の、軸に沿った箱。メートル）。 */
export interface FurnitureBox {
	readonly name: string;
	readonly min: P3;
	readonly max: P3;
}

/** カメラのニアクリップ（メートル）。壁際で壁の中が映らないよう、小さくする。 */
export const CAMERA_NEAR = 0.03;
/** カメラの縦の画角（度。scene.ts の PerspectiveCamera と同じ）。 */
export const CAMERA_FOV = 60;
/** 守りで考える、画面の横長の上限（横 / 縦。スマホの横向きを含む）。 */
export const CAMERA_MAX_ASPECT = 2.4;
/** 壁の面が、地図の格子の線から部屋の側へ出ている距離の最大（メートル。平屋の glb で実測）。 */
export const WALL_FACE_OFFSET = 0.125;
/** カメラを家具の箱から離す距離（メートル。水平と高さのどちらか）。 */
export const CAMERA_FURNITURE_MARGIN = 0.1;
/** 水平の距離を探す刻み（メートル）。 */
const REACH_STEP = 0.05;
/**
 * 体の円柱（半径 BODY_RADIUS・足もとから BODY_HEIGHT）が、箱に重なるか。重なる箱は、体を隠すとは
 * みなさない（体が家具に入り込んだ場所では、どこにカメラを置いても重なった部分は隠れるため）。
 */
export function bodyOverlapsBox(
	body: { readonly x: number; readonly z: number; readonly feet: number },
	box: FurnitureBox,
): boolean {
	if (body.feet + BODY_HEIGHT <= box.min.y || body.feet >= box.max.y) {
		return false;
	}
	const dx = Math.max(box.min.x - body.x, 0, body.x - box.max.x);
	const dz = Math.max(box.min.z - body.z, 0, body.z - box.max.z);
	return Math.hypot(dx, dz) < BODY_RADIUS;
}
/** 押し戻しを繰り返す回数（角では2方向から押すため）。 */
const PUSH_ROUNDS = 4;

/** ニアクリップの面の角までの距離（near・縦の画角 fov 度・横長 aspect）。 */
export function nearPlaneReach(
	near: number,
	fov: number,
	aspect: number,
): number {
	const half = near * Math.tan((fov * Math.PI) / 360);
	return Math.hypot(near, half, half * aspect);
}

/** カメラの位置から、近くの面までに要る距離（ニアクリップの面がめり込まない）。 */
export const NEAR_CLEARANCE = nearPlaneReach(
	CAMERA_NEAR,
	CAMERA_FOV,
	CAMERA_MAX_ASPECT,
);

/** 線分 a→b が箱に入る割合（0〜1）。当たらなければ null。a が箱の中なら 0。 */
export function segmentHitsBox(a: P3, b: P3, box: FurnitureBox): number | null {
	let t0 = 0;
	let t1 = 1;
	for (const k of ["x", "y", "z"] as const) {
		const d = b[k] - a[k];
		if (Math.abs(d) < 1e-12) {
			if (a[k] < box.min[k] || a[k] > box.max[k]) return null;
			continue;
		}
		let enter = (box.min[k] - a[k]) / d;
		let leave = (box.max[k] - a[k]) / d;
		if (enter > leave) [enter, leave] = [leave, enter];
		t0 = Math.max(t0, enter);
		t1 = Math.min(t1, leave);
		if (t0 > t1) return null;
	}
	return t0;
}

/** 点から箱までの距離（中なら 0）。 */
export function distanceToBox(p: P3, box: FurnitureBox): number {
	const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
	const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
	const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
	return Math.hypot(dx, dy, dz);
}

/** 点から線分までの距離（水平）。 */
export function distanceToSegment(p: P2, a: P2, b: P2): number {
	const q = closestOnSegment(p, a, b);
	return Math.hypot(p.x - q.x, p.z - q.z);
}

function closestOnSegment(p: P2, a: P2, b: P2): P2 {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length = dx * dx + dz * dz;
	const t =
		length === 0
			? 0
			: Math.max(
					0,
					Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length),
				);
	return { x: a.x + dx * t, z: a.z + dz * t };
}

/** 領域の境の辺（線分）。 */
export interface BoundaryEdge {
	readonly from: P2;
	readonly to: P2;
}

/**
 * マス cell のまわり（3×3 のマス）にある、領域の境の辺。領域が違う2マス（歩けないマスを含む）の間の
 * 辺で、壁とすべての戸を含む（カメラは戸を越えない / ADR 0043）。
 */
export function boundaryEdges(grid: StageGrid, cell: Cell): BoundaryEdge[] {
	const edges: BoundaryEdge[] = [];
	const s = grid.cellSize;
	const { x: ox, z: oz } = grid.origin;
	for (let z = cell.z - 1; z <= cell.z + 1; z++) {
		for (let x = cell.x - 1; x <= cell.x + 1; x++) {
			const region = grid.regionAt({ x, z });
			if (x <= cell.x && grid.regionAt({ x: x + 1, z }) !== region) {
				edges.push({
					from: { x: ox + s * (x + 1), z: oz + s * z },
					to: { x: ox + s * (x + 1), z: oz + s * (z + 1) },
				});
			}
			if (z <= cell.z && grid.regionAt({ x, z: z + 1 }) !== region) {
				edges.push({
					from: { x: ox + s * x, z: oz + s * (z + 1) },
					to: { x: ox + s * (x + 1), z: oz + s * (z + 1) },
				});
			}
		}
	}
	return edges;
}

const cellOf = (grid: StageGrid, p: P2): Cell => ({
	x: Math.floor((p.x - grid.origin.x) / grid.cellSize),
	z: Math.floor((p.z - grid.origin.z) / grid.cellSize),
});

/** カメラの位置を、領域の境から wallMargin だけ水平に離す（角では2方向から押す）。 */
function pushFromWalls(
	grid: StageGrid,
	body: P2,
	from: P2,
	wallMargin: number,
): P2 {
	let x = from.x;
	let z = from.z;
	for (let round = 0; round < PUSH_ROUNDS; round++) {
		let moved = false;
		for (const edge of boundaryEdges(grid, cellOf(grid, { x, z }))) {
			const q = closestOnSegment({ x, z }, edge.from, edge.to);
			let dx = x - q.x;
			let dz = z - q.z;
			let d = Math.hypot(dx, dz);
			if (d >= wallMargin) continue;
			if (d < 1e-9) {
				// 線の上: 体の側へ押す。
				dx = body.x - q.x;
				dz = body.z - q.z;
				d = Math.hypot(dx, dz);
				if (d < 1e-9) continue;
			}
			x = q.x + (dx / d) * wallMargin;
			z = q.z + (dz / d) * wallMargin;
			moved = true;
		}
		if (!moved) break;
	}
	return { x, z };
}

/** 高さ y のカメラが、箱（余白つき）の水平の範囲の中か。高さが重ならなければ false。 */
function inBoxAt(p: P2, y: number, box: FurnitureBox): boolean {
	const m = CAMERA_FURNITURE_MARGIN;
	if (y <= box.min.y - m || y >= box.max.y + m) return false;
	return (
		p.x > box.min.x - m &&
		p.x < box.max.x + m &&
		p.z > box.min.z - m &&
		p.z < box.max.z + m
	);
}

/**
 * カメラの位置を、近くの面から水平に離す。まず領域の境から wallMargin。次に、高さが重なる家具の箱
 * （余白 CAMERA_FURNITURE_MARGIN つき）の中なら、中に入っている箱すべての4つの面の外を候補にし、それぞれに境からの
 * 押し戻しを当てたあとも、体と同じ領域で、どの箱にもかからないもののうち、いちばん近いところへ出す
 * （壁際の家具で、壁の側へ出して壁と押し合いにならないように）。候補が無ければ動かさない。
 */
function pushAway(
	grid: StageGrid,
	body: P2,
	position: P3,
	boxes: readonly FurnitureBox[],
	wallMargin: number,
): P3 {
	const y = position.y;
	const home = grid.regionAt(cellOf(grid, body));
	let at = pushFromWalls(grid, body, position, wallMargin);
	for (let round = 0; round < PUSH_ROUNDS; round++) {
		const containing = boxes.filter((b) => inBoxAt(at, y, b));
		if (containing.length === 0) break;
		const m = CAMERA_FURNITURE_MARGIN + 1e-6;
		// 中に入っている箱すべての、4つの面の外（入れ子の箱では、外側の箱の面を選べるように）。
		const best = containing
			.flatMap((box) => [
				{ x: box.min.x - m, z: at.z },
				{ x: box.max.x + m, z: at.z },
				{ x: at.x, z: box.min.z - m },
				{ x: at.x, z: box.max.z + m },
			])
			.map((c) => pushFromWalls(grid, body, c, wallMargin))
			.filter(
				(c) =>
					grid.regionAt(cellOf(grid, c)) === home &&
					!boxes.some((b) => inBoxAt(c, y, b)),
			)
			.sort(
				(a, b) =>
					Math.hypot(a.x - at.x, a.z - at.z) -
					Math.hypot(b.x - at.x, b.z - at.z),
			)[0];
		if (best === undefined) break;
		at = best;
	}
	return { x: at.x, y, z: at.z };
}

/** 箱（余白つき）の中か。 */
function insideExpanded(p: P3, box: FurnitureBox, m: number): boolean {
	return (
		p.x > box.min.x - m &&
		p.x < box.max.x + m &&
		p.y > box.min.y - m &&
		p.y < box.max.y + m &&
		p.z > box.min.z - m &&
		p.z < box.max.z + m
	);
}

/** 守りを当てたカメラの置き方（水平の距離 reach。見る点は変えない）。 */
export function placeGuardedCamera(
	grid: StageGrid,
	center: { readonly x: number; readonly z: number; readonly feet: number },
	yaw: number,
	reach: number,
	boxes: readonly FurnitureBox[],
	settings: CameraSettings = DEFAULT_CAMERA,
): ReachedPose {
	const pose = reachedPose(center, yaw, reach, settings);
	return {
		...pose,
		position: pushAway(grid, center, pose.position, boxes, settings.wallMargin),
	};
}

/**
 * カメラの位置の守れ方。"ok" はすべて守れている。"hidden" はめり込まない（領域の中・境と家具から
 * 離れている）が、家具が体を隠す。"bad" はめり込む。
 */
function guardLevel(
	grid: StageGrid,
	center: { readonly x: number; readonly z: number; readonly feet: number },
	position: P3,
	boxes: readonly FurnitureBox[],
	wallMargin: number,
): "ok" | "hidden" | "bad" {
	if (cameraReach(grid, center, position) !== 1) return "bad";
	for (const edge of boundaryEdges(grid, cellOf(grid, position))) {
		if (distanceToSegment(position, edge.from, edge.to) < wallMargin - 1e-6) {
			return "bad";
		}
	}
	for (const box of boxes) {
		if (insideExpanded(position, box, CAMERA_FURNITURE_MARGIN - 1e-6)) {
			return "bad";
		}
	}
	const eye = { x: center.x, y: center.feet + EYE_HEIGHT, z: center.z };
	for (const box of boxes) {
		if (
			!bodyOverlapsBox(center, box) &&
			segmentHitsBox(eye, position, box) !== null
		) {
			return "hidden";
		}
	}
	return "ok";
}

/**
 * 守りを当てて許される、カメラの水平の距離。地図の守り（体からカメラへの線が、境の手前
 * CAMERA_WALL_MARGIN で止まる）の距離から、REACH_STEP ずつ縮め、カメラの位置が守れる、いちばん
 * 遠い距離を返す。家具が体を隠さない距離が無ければ（体が家具の下や中に入り込んだとき）、めり込まない
 * いちばん遠い距離。それも無ければ 0。
 */
export function allowedCameraReach(
	grid: StageGrid,
	center: { readonly x: number; readonly z: number; readonly feet: number },
	yaw: number,
	boxes: readonly FurnitureBox[],
	settings: CameraSettings = DEFAULT_CAMERA,
): number {
	const full = fullReach(settings);
	const want = {
		x: center.x + Math.sin(yaw) * full,
		z: center.z + Math.cos(yaw) * full,
	};
	const map = Math.max(
		0,
		Math.min(
			full,
			cameraReach(grid, center, want) * full - settings.wallMargin,
		),
	);
	// 体の近くの家具だけを見る（遠い家具は、カメラに届かない）。
	const nearby = boxes.filter(
		(box) =>
			distanceToBox({ x: center.x, y: box.min.y, z: center.z }, box) <=
			full + CAMERA_FURNITURE_MARGIN + settings.wallMargin,
	);
	// 家具が体を隠さない、いちばん遠い距離。どこでも隠れるなら、めり込まない、いちばん遠い距離。
	let fallback = 0;
	for (let h = map; h > 0; h -= REACH_STEP) {
		const pose = placeGuardedCamera(grid, center, yaw, h, nearby, settings);
		const level = guardLevel(
			grid,
			center,
			pose.position,
			nearby,
			settings.wallMargin,
		);
		if (level === "ok") return h;
		if (level === "hidden" && fallback === 0) fallback = h;
	}
	return fallback;
}
