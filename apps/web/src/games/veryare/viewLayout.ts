/**
 * 3D の画面の大きさから決める値（純粋関数。three と React を使わない）。
 *
 * ゲーム画面は、画面いっぱいの 1 枚にした（上部バーと状態の行の残りが、すべて 3D の画面）。3D の画面は、
 * これまでの 3:4 より縦に長くなるので、カメラの縦の画角を広げ、横の画角を 3:4 のときと同じに保つ
 * （横方向を切り詰めない）。パッドと撃つボタンの大きさも、3D の画面の大きさで決める（小さい画面では
 * 小さくする）。
 */

import { BODY_HEIGHT } from "./bodySize";
import { CAMERA_PITCH, cameraPose } from "./camera";
import { CAMERA_FOV } from "./cameraGuard";

/** これまでの 3D の画面の縦横比（横 / 縦）。横の画角は、この形のときの角度に揃える。 */
export const REFERENCE_ASPECT = 3 / 4;
/**
 * 鬼の視界の判定（見逃しポイント / ADR 0036）に使う縦横比。画面の形で点数が変わらないよう、
 * どの端末でも、これまでの 3:4 の枠で見る。
 */
export const SIGHT_ASPECT = REFERENCE_ASPECT;
/** 縦の画角の上限（度）。とても縦に長い画面で、上下が広がりすぎないよう止める。 */
export const FOV_MAX = 80;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * 縦横比 aspect（横 / 縦）の画面での、カメラの縦の画角（度）。3:4 と、それより横に広い画面では
 * CAMERA_FOV のまま。縦に長い画面では、横の画角が 3:4 のときと同じになるよう広げる（上限 FOV_MAX）。
 */
export function fovForAspect(aspect: number): number {
	if (aspect >= REFERENCE_ASPECT) return CAMERA_FOV;
	if (aspect <= 0) return FOV_MAX;
	const halfWidth = Math.tan(toRad(CAMERA_FOV / 2)) * REFERENCE_ASPECT;
	return Math.min(toDeg(2 * Math.atan(halfWidth / aspect)), FOV_MAX);
}

/** パッドの大きさ（px）の範囲。 */
const PAD_MIN = 84;
const PAD_MAX = 120;
/** 撃つボタンの大きさ（px）の範囲。 */
const SHOOT_MIN = 60;
const SHOOT_MAX = 80;

const clamp = (min: number, value: number, max: number) =>
	Math.min(Math.max(value, min), max);

/**
 * 3D の画面の幅 width・高さ height（px）での、パッド（移動・視点）と撃つボタンの大きさ（px）。
 * 幅の 27%・高さの 22% の小さい方を、84〜120 px に収める。撃つボタンは、パッドの 68% を 60〜80 px に。
 * 大きさが分からない間（0）は、これまでの大きさ（120・80）。
 */
export function controlSizes(
	width: number,
	height: number,
): { readonly pad: number; readonly shoot: number } {
	if (width <= 0 || height <= 0) return { pad: PAD_MAX, shoot: SHOOT_MAX };
	const pad = clamp(
		PAD_MIN,
		Math.round(Math.min(width * 0.27, height * 0.22)),
		PAD_MAX,
	);
	const shoot = clamp(SHOOT_MIN, Math.round(pad * 0.68), SHOOT_MAX);
	return { pad, shoot };
}

/** 動かしたシートを、3D の画面の端から離す距離（px）。 */
const PANEL_MARGIN = 8;

/**
 * 動かしたシート（ペイントの板・答え合わせの切り替え）の左上の位置 position を、3D の画面 view の
 * 内側（端から 8 px）に収める。シートが画面より大きければ、左上に寄せる。
 */
export function clampPanel(
	position: { readonly x: number; readonly y: number },
	panel: { readonly width: number; readonly height: number },
	view: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
	const axis = (value: number, size: number, room: number) =>
		Math.max(PANEL_MARGIN, Math.min(value, room - size - PANEL_MARGIN));
	return {
		x: axis(position.x, panel.width, view.width),
		y: axis(position.y, panel.height, view.height),
	};
}

/** 上に出すペイントの板の、3D の画面の上端からの余白と、頭とのすき間（px）。 */
export const PAINT_SHEET_GAP = 8;

/**
 * 3D の画面（幅 width・高さ height。px）で、自分の頭のてっぺんが映る高さ（上端からの px）。開けた所の
 * 三人称カメラ（camera.ts の cameraPose。距離・見下ろす角度・高さの上限は既定）と、縦の画角
 * （fovForAspect）で求める。壁際でカメラが近づくと、体は大きく映り、頭はこれより上に来る。
 */
export function bodyTopOnView(width: number, height: number): number {
	const { position, target } = cameraPose(
		{ x: 0, z: 0, feet: 0 },
		0,
		CAMERA_PITCH,
	);
	// yaw 0 のカメラは +z の側から -z を向く。縦の面（前 = -z、上 = y）で考える。
	const forward = { h: position.z - target.z, y: target.y - position.y };
	const size = Math.hypot(forward.h, forward.y);
	const f = { h: forward.h / size, y: forward.y / size };
	const up = { h: -f.y, y: f.h };
	const head = { h: position.z, y: BODY_HEIGHT - position.y };
	const depth = head.h * f.h + head.y * f.y;
	const rise = head.h * up.h + head.y * up.y;
	const half = Math.tan(toRad(fovForAspect(width / height) / 2));
	return (height / 2) * (1 - rise / depth / half);
}

/**
 * 上に出すペイントの板（動ける隠れ側の規則 / ADR 0053）の高さの上限（px）。頭のてっぺんから、上の余白と、
 * 頭とのすき間を引く（板が体を隠さない）。大きさが分からない間（0）は null（上限を付けない）。
 */
export function paintSheetMaxHeight(
	width: number,
	height: number,
): number | null {
	if (width <= 0 || height <= 0) return null;
	return Math.floor(bodyTopOnView(width, height) - 2 * PAINT_SHEET_GAP);
}
