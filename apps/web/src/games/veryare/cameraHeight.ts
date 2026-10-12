/**
 * ステージのカメラの高さが、壁や襖・欄間を越えて向こうの部屋を見られないかの判定（issue-46 /
 * ADR 0043）。three を使わない。
 *
 * カメラは体のいる領域の外に出ない（cameraRig.ts）が、高ければ、壁の上端や、襖の上の欄間（透かし）
 * 越しに、向こうの部屋が見える。カメラの最高点（その領域の床の最大 ＋ 足もとからのカメラの最大の
 * 高さ）が、遮るもの（壁の上端、閉じた襖の板の上端、欄間の下端）より低ければ、そこからの視線は
 * 上向きにしか越えられず、向こうの床の上にいる隠れ側は見えない。カメラは、天井（天井の無い縁側は、
 * 屋根の軒）の下面よりも低くなければならない。
 */

import { CAMERA_FULL_REACH, reachedPose } from "./cameraRig";
import { WALL_HEIGHT } from "./stageBoxes";

/** 領域の遮るもの（ワールドの y、メートル）。接していないものは null。 */
export interface Obstacles {
	/** 領域の床の最大（例外のマスを含む）。 */
	readonly floorMax: number;
	/** 接する壁の上端の最小。 */
	readonly wallTop: number;
	/** 接する襖の板の上端の最小（閉じているとき）。 */
	readonly fusumaTop: number | null;
	/** 接する欄間（透かし）の下端の最小。 */
	readonly ranmaBottom: number | null;
	/** 天井の下面の最小（天井の無い縁側は、屋根の軒の下面）。測っていなければ null。 */
	readonly ceiling: number | null;
}

/**
 * 平屋の領域ごとの遮るもの。tools/wall_heights.mjs の REGION の行を書き写したもの（手では決めない）。
 * 壁は内壁・床の間の壁が 3.3 m、外壁が 3.5 m で、途中が低くなっている所は無かった。天井の下面は
 * どの部屋も 3.3 m。縁側には天井が無く、屋根の軒の下面（3.162 m）を使う。
 */
export const HIRAYA_OBSTACLES: Readonly<Record<string, Obstacles>> = {
	".": {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // 東の廊下
	":": {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // 広縁
	"=": {
		floorMax: 0.55,
		wallTop: 3.5,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.162,
	}, // 縁側
	"@": {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // 玄関
	A: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // 和室A
	B: {
		floorMax: 0.72,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // 和室B（床の間）
	C: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // 和室C
	D: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
		ceiling: 3.3,
	}, // ダイニング
	F: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // 風呂
	K: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // キッチン
	T: {
		floorMax: 0.8,
		wallTop: 3.3,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // トイレ（段）
	W: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: null,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // 洗面所
	o: {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 3.085,
		ranmaBottom: null,
		ceiling: 3.3,
	}, // 押入れ
};

/**
 * 箱の表示（stageBoxes.ts）。床は 0、壁は 2.4 m。閉じた襖の板は 1.8 m だが、その上は鴨居の箱で
 * 壁と同じ 2.4 m までふさがるので、透かしは無い（襖の板の上端は、壁の上端と同じに扱う）。
 */
export const BOX_OBSTACLES: Obstacles = {
	floorMax: 0,
	wallTop: WALL_HEIGHT,
	fusumaTop: null,
	ranmaBottom: null,
	// 箱の表示には天井が無い（壁の上は空いているが、カメラは壁より低いので、壁の上端で足りる）。
	ceiling: null,
};

/** 領域の中に収めたカメラの、足もとからの最大の高さ（reachedPose を細かく区切って求める）。 */
export function cameraTopAboveFeet(steps = 2000): number {
	let top = 0;
	for (let i = 0; i <= steps; i++) {
		const pose = reachedPose(
			{ x: 0, z: 0, feet: 0 },
			0,
			(CAMERA_FULL_REACH * i) / steps,
		);
		top = Math.max(top, pose.position.y);
	}
	return top;
}

export interface PeekRisk {
	readonly kind: "wall" | "fusuma" | "ranma" | "ceiling";
	/** カメラの最高点が、遮るものを越える量（メートル）。 */
	readonly over: number;
}

/** カメラの最高点（床の最大 ＋ cameraTop）が、遮るものに届く・越えるもの（壁・襖・欄間・天井の順）。 */
export function peekRisks(obstacles: Obstacles, cameraTop: number): PeekRisk[] {
	const camera = obstacles.floorMax + cameraTop;
	const limits: [PeekRisk["kind"], number | null][] = [
		["wall", obstacles.wallTop],
		["fusuma", obstacles.fusumaTop],
		["ranma", obstacles.ranmaBottom],
		["ceiling", obstacles.ceiling],
	];
	return limits
		.filter((entry): entry is [PeekRisk["kind"], number] => entry[1] !== null)
		.filter(([, limit]) => camera >= limit)
		.map(([kind, limit]) => ({ kind, over: camera - limit }));
}

/** カメラの最高点から、いちばん低い遮るものまでの余裕（メートル。負なら越えている）。 */
export function clearance(obstacles: Obstacles, cameraTop: number): number {
	const lowest = Math.min(
		obstacles.wallTop,
		obstacles.fusumaTop ?? Number.POSITIVE_INFINITY,
		obstacles.ranmaBottom ?? Number.POSITIVE_INFINITY,
		obstacles.ceiling ?? Number.POSITIVE_INFINITY,
	);
	return lowest - (obstacles.floorMax + cameraTop);
}
