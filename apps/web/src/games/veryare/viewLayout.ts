/**
 * 3D の画面の大きさから決める値（純粋関数。three と React を使わない）。
 *
 * ゲーム画面は、画面いっぱいの 1 枚にした（上部バーと状態の行の残りが、すべて 3D の画面）。3D の画面は、
 * これまでの 3:4 より縦に長くなるので、カメラの縦の画角を広げ、横の画角を 3:4 のときと同じに保つ
 * （横方向を切り詰めない）。パッドと撃つボタンの大きさも、3D の画面の大きさで決める（小さい画面では
 * 小さくする）。
 */

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
