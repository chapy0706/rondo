/**
 * ステージの TPS カメラを、体のいる領域の外に出さない（issue-46 / ADR 0043）。three を使わない。
 *
 * カメラが壁の向こうに出ると、鬼の画面に隣の部屋の隠れ側が描かれる（隠れ側の状態は全員に届いて
 * いる / ADR 0035）。そこで、体からカメラへの線を地図の格子でたどり、領域が変わる境（壁、すべての戸、
 * 開いた襖を含む）の手前で止める。近づいたぶん、見下ろす角度を上げる。縮むときは即座、伸びるときは
 * なめらかに戻す（camera.ts の定数）。
 */

import { type CameraSettings, DEFAULT_CAMERA, EYE_HEIGHT } from "./camera";
import type { Point } from "./rules";
import type { StageGrid } from "./stage";

/** 角をちょうど通るとみなす割合の差。 */
const SAME_TIME = 1e-9;
const NEVER = 1e18;

/**
 * from（体）から to（カメラ）への線分のうち、体のマス（位置のマス）の領域に収まる割合（0〜1）。
 * 線分をマスごとにたどり、領域が変わる境（または歩けないマス）に当たったら、その割合を返す。
 * 角をちょうど通るときは、両脇と角のマスがすべて同じ領域のときだけ通す（安全側）。
 * 体のマスが歩けなければ 0。
 */
export function cameraReach(grid: StageGrid, from: Point, to: Point): number {
	const u0 = (from.x - grid.origin.x) / grid.cellSize;
	const v0 = (from.z - grid.origin.z) / grid.cellSize;
	const du = (to.x - grid.origin.x) / grid.cellSize - u0;
	const dv = (to.z - grid.origin.z) / grid.cellSize - v0;
	let cell = { x: Math.floor(u0), z: Math.floor(v0) };
	const region = grid.regionAt(cell);
	if (region === null) return 0;
	const stepX = Math.sign(du);
	const stepZ = Math.sign(dv);
	const deltaX = du === 0 ? NEVER : 1 / Math.abs(du);
	const deltaZ = dv === 0 ? NEVER : 1 / Math.abs(dv);
	const first = (start: number, d: number, index: number) =>
		d > 0 ? (index + 1 - start) / d : d < 0 ? (index - start) / d : NEVER;
	let tX = first(u0, du, cell.x);
	let tZ = first(v0, dv, cell.z);
	const inside = (c: { x: number; z: number }) => grid.regionAt(c) === region;
	for (;;) {
		const t = Math.min(tX, tZ);
		if (t >= 1) return 1;
		if (Math.abs(tX - tZ) < SAME_TIME) {
			const sideX = { x: cell.x + stepX, z: cell.z };
			const sideZ = { x: cell.x, z: cell.z + stepZ };
			const corner = { x: cell.x + stepX, z: cell.z + stepZ };
			if (!(inside(sideX) && inside(sideZ) && inside(corner))) {
				return Math.max(0, t);
			}
			cell = corner;
			tX += deltaX;
			tZ += deltaZ;
		} else if (tX < tZ) {
			const next = { x: cell.x + stepX, z: cell.z };
			if (!inside(next)) return Math.max(0, tX);
			cell = next;
			tX += deltaX;
		} else {
			const next = { x: cell.x, z: cell.z + stepZ };
			if (!inside(next)) return Math.max(0, tZ);
			cell = next;
			tZ += deltaZ;
		}
	}
}

/** 開けた所での、カメラの水平の距離（メートル）。 */
export function fullReach(settings: CameraSettings = DEFAULT_CAMERA): number {
	return settings.distance * Math.cos(settings.pitch);
}

/** 既定の定数での、開けた所の水平の距離。 */
export const CAMERA_FULL_REACH = fullReach(DEFAULT_CAMERA);

/** カメラの置き方と、その見下ろす角度。 */
export interface ReachedPose {
	readonly position: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly target: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly pitch: number;
}

/**
 * 水平の距離 reach（0〜fullReach）でのカメラ。見る点は足もとから EYE_HEIGHT。近いほど見下ろす角度を
 * settings.pitch から settings.pitchMax へ上げ、高さは reach × tan(角度)（下限 settings.minHeight）。
 * reach がいっぱいなら、camera.ts の cameraPose と同じ位置になる。
 */
export function reachedPose(
	center: { readonly x: number; readonly z: number; readonly feet: number },
	yaw: number,
	reach: number,
	settings: CameraSettings = DEFAULT_CAMERA,
): ReachedPose {
	const full = fullReach(settings);
	const h = Math.min(Math.max(reach, 0), full);
	const closeness = full > 0 ? 1 - h / full : 1;
	const pitch =
		settings.pitch + (settings.pitchMax - settings.pitch) * closeness;
	const eye = { x: center.x, y: center.feet + EYE_HEIGHT, z: center.z };
	const up = Math.max(h * Math.tan(pitch), settings.minHeight);
	// 見る点は、近づいたぶん、カメラの向きの前方（体から見てカメラと反対の側）へずらす。
	const ahead = settings.lookAhead * closeness;
	return {
		target: {
			x: eye.x - Math.sin(yaw) * ahead,
			y: eye.y,
			z: eye.z - Math.cos(yaw) * ahead,
		},
		pitch,
		position: {
			x: eye.x + Math.sin(yaw) * h,
			// 高さの上限（足もとから）。上限にかかっても、見る点（目）より下にはしない。
			y: Math.max(
				Math.min(eye.y + up, center.feet + settings.maxHeight),
				eye.y + 0.01,
			),
			z: eye.z + Math.cos(yaw) * h,
		},
	};
}

/**
 * 開発中だけ Console に出す、カメラの高さの1行（issue-46）。feet は体の足もと（床）の高さ、cameraY は
 * カメラの世界の y、reach は水平の距離、lookDown は実際に見下ろしている角度（ラジアン）。
 */
export function cameraLogMessage(info: {
	readonly feet: number;
	readonly cameraY: number;
	readonly reach: number;
	readonly lookDown: number;
}): string {
	const degrees = Math.round((info.lookDown * 180) / Math.PI);
	return `[veryare-camera] 床 ${info.feet.toFixed(2)} m・カメラは床から ${(info.cameraY - info.feet).toFixed(2)} m（世界の y ${info.cameraY.toFixed(2)}）・水平の距離 ${info.reach.toFixed(2)} m・見下ろす角度 ${degrees}°`;
}

/**
 * カメラの水平の距離を、許される距離 allowed へ寄せる。縮むときは即座（領域の外に出さない）、
 * 伸びるときは CAMERA_SETTLE_SECONDS で 95% を追う速さで寄せる（行き過ぎない）。
 */
export function followCameraReach(
	current: number,
	allowed: number,
	dtSeconds: number,
	settleSeconds: number = DEFAULT_CAMERA.settleSeconds,
): number {
	if (allowed <= current) return allowed;
	if (dtSeconds <= 0 || settleSeconds <= 0) {
		return settleSeconds <= 0 ? allowed : current;
	}
	// 95% を追う時間から決めた、指数の追従の時定数（e^-3 ≒ 5%）。
	const next =
		allowed + (current - allowed) * Math.exp(-dtSeconds / (settleSeconds / 3));
	return Math.abs(next - allowed) < 1e-4 ? allowed : next;
}
