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
/**
 * いちばん近づいたとき（水平の距離 0）の、見下ろす角度（ラジアン。約 26°）。1.1 rad（約 63°）では、
 * 移動中にカメラが天井のほうへ上がって気になったため 0.6 に下げ、それでも壁際で上から床を見る
 * 視点になったため、さらに下げた。足りない見え方は CAMERA_LOOK_AHEAD で補う。
 */
export const CAMERA_PITCH_MAX = 0.45;
/**
 * カメラがいちばん近づいたとき、見る点をカメラの向きの前方へずらす距離（メートル。水平）。近づいたぶん
 * （1 - 水平の距離 / 開けた所の距離）に比例してずらす。カメラの位置は変えない（ADR 0043 はそのまま）。
 * 体の真上から足もとを見下ろさず、進む先が見えるようにするため。
 */
export const CAMERA_LOOK_AHEAD = 1.0;
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
	distance = CAMERA_DISTANCE,
): CameraPose {
	const target = { x: center.x, y: center.feet + EYE_HEIGHT, z: center.z };
	const back = Math.cos(pitch) * distance;
	return {
		target,
		position: {
			x: target.x + Math.sin(yaw) * back,
			y: target.y + Math.sin(pitch) * distance,
			z: target.z + Math.cos(yaw) * back,
		},
	};
}

/** カメラの定数をまとめたもの（開発中だけ URL で変えられる / cameraSettings）。 */
export interface CameraSettings {
	/** カメラとキャラクターの距離（CAMERA_DISTANCE）。 */
	readonly distance: number;
	/** 見下ろす角度の既定（CAMERA_PITCH）。 */
	readonly pitch: number;
	/** いちばん近づいたときの角度（CAMERA_PITCH_MAX）。 */
	readonly pitchMax: number;
	/** 境から手前に離す距離（CAMERA_WALL_MARGIN）。 */
	readonly wallMargin: number;
	/** 伸びるときに 95% を追う時間（CAMERA_SETTLE_SECONDS）。 */
	readonly settleSeconds: number;
	/** 見る点からの高さの下限（CAMERA_MIN_HEIGHT）。 */
	readonly minHeight: number;
	/** いちばん近づいたとき、見る点を前方へずらす距離（CAMERA_LOOK_AHEAD）。 */
	readonly lookAhead: number;
}

export const DEFAULT_CAMERA: CameraSettings = {
	distance: CAMERA_DISTANCE,
	pitch: CAMERA_PITCH,
	pitchMax: CAMERA_PITCH_MAX,
	wallMargin: CAMERA_WALL_MARGIN,
	settleSeconds: CAMERA_SETTLE_SECONDS,
	minHeight: CAMERA_MIN_HEIGHT,
	lookAhead: CAMERA_LOOK_AHEAD,
};

/** URL の名前と、受け付ける範囲（範囲の外や数でない値は、既定のまま）。 */
const URL_KEYS: readonly [keyof CameraSettings, string, number, number][] = [
	["distance", "camDistance", 0.5, 6],
	["pitch", "camPitch", 0, 1.4],
	["pitchMax", "camPitchMax", 0, 1.4],
	["wallMargin", "camMargin", 0, 1],
	["settleSeconds", "camSettle", 0, 2],
	["minHeight", "camMinHeight", 0, 2],
	["lookAhead", "camLookAhead", 0, 3],
];

/**
 * カメラの定数。開発用の合図（dev = NEXT_PUBLIC_VERYARE_HIRAYA、または URL の ?roof=1）があるときだけ、
 * URL の指定（例: ?camPitchMax=0.45&camLookAhead=1.5）で変える。本番の既定では、いつも DEFAULT_CAMERA。
 * 角度の上限が既定の角度より小さければ、既定の角度にそろえる（近づいて角度が下がらないように）。
 */
export function cameraSettings(dev: boolean, search: string): CameraSettings {
	const params = new URLSearchParams(search);
	if (!dev && params.get("roof") !== "1") return DEFAULT_CAMERA;
	const settings: Record<keyof CameraSettings, number> = { ...DEFAULT_CAMERA };
	for (const [key, name, min, max] of URL_KEYS) {
		const raw = params.get(name);
		const value = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
		if (Number.isFinite(value) && value >= min && value <= max) {
			settings[key] = value;
		}
	}
	settings.pitchMax = Math.max(settings.pitchMax, settings.pitch);
	return settings;
}

/**
 * カメラが自分の体に近づいたときの半透明（体の中をカメラが映さないように / issue-46）。カメラの水平の
 * 距離が BODY_FADE_START より近いと薄くし始め、BODY_FADE_END で BODY_MIN_OPACITY になる。
 */
export const BODY_FADE_START = 1.0;
export const BODY_FADE_END = 0.3;
export const BODY_MIN_OPACITY = 0.25;

/** カメラの水平の距離 reach（メートル）での、自分の体の不透明度（BODY_MIN_OPACITY〜1）。 */
export function selfBodyOpacity(reach: number): number {
	if (reach >= BODY_FADE_START) return 1;
	if (reach <= BODY_FADE_END) return BODY_MIN_OPACITY;
	const t = (reach - BODY_FADE_END) / (BODY_FADE_START - BODY_FADE_END);
	return BODY_MIN_OPACITY + (1 - BODY_MIN_OPACITY) * t;
}
