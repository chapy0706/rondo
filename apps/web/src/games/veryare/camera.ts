/**
 * 三人称カメラの定数（ADR 0034）。three.js を読まずに使えるよう、scene.ts から分けている。
 * 狭い廊下で壁に隠れて自分が見えなくなる点は、目視の結果を見てから決める（issue-29d）。
 * リハーサルで変えるときは、ここだけを書き換える。
 */

/** カメラとキャラクターの距離（メートル）。 */
export const CAMERA_DISTANCE = 2.6;
/** カメラが見下ろす角度（ラジアン）。 */
export const CAMERA_PITCH = 0.35;
/** 目線の高さ（カメラが見る点。メートル）。 */
export const EYE_HEIGHT = 0.8;

/**
 * ステージのカメラを、体のいる領域の外に出さないための定数（ADR 0043）。カメラは、体からカメラへの
 * 線上で、領域が変わる境（壁・すべての戸）の手前で止め、近づいたぶん見下ろす角度を上げる。
 * 戸口を通るときの見え方は、これらの値だけで調整する。
 */
/** 境から、カメラを手前に離す距離（メートル。水平）。 */
export const CAMERA_WALL_MARGIN = 0.2;
/** いちばん近づいたとき（水平の距離 0）の、見下ろす角度（ラジアン）。 */
export const CAMERA_PITCH_MAX = 1.1;
/** カメラが離れていく（伸びる）とき、95% を追うまでの時間（秒）。近づく（縮む）ときは即座。 */
export const CAMERA_SETTLE_SECONDS = 0.15;
/** カメラを、見る点からこれより低くしない（メートル。水平の距離が 0 でも、向きが決まるように）。 */
export const CAMERA_MIN_HEIGHT = 0.4;

/** カメラの位置と、見る点（メートル。three を使わない）。 */
export interface CameraPose {
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
}

/**
 * 三人称カメラの置き方（ADR 0034）。center は、カメラの中心にする体の位置と、その足もとの高さ
 * （feet。平屋では床の高さ / issue-46）。見る点は足もとから EYE_HEIGHT の高さで、カメラはそこから
 * CAMERA_DISTANCE 離れ、pitch だけ見下ろす。yaw 0 で -z を向く（カメラは体の +z 側の後ろ）。
 * 足もとが上がれば、カメラと見る点は同じだけ上がる（距離と角度は変わらない）。
 */
export function cameraPose(
	center: { readonly x: number; readonly z: number; readonly feet: number },
	yaw: number,
	pitch: number,
): CameraPose {
	const target = { x: center.x, y: center.feet + EYE_HEIGHT, z: center.z };
	const back = Math.cos(pitch) * CAMERA_DISTANCE;
	return {
		target,
		position: {
			x: target.x + Math.sin(yaw) * back,
			y: target.y + Math.sin(pitch) * CAMERA_DISTANCE,
			z: target.z + Math.cos(yaw) * back,
		},
	};
}
