/**
 * 平屋の固定ステージ（issue-46 / ADR 0039）の、表示のための純粋関数。three を使わない。
 *
 * - 平屋かどうかは、ステージの通知の形（1マスの大きさ・幅・奥行き・原点・玄関）で見分ける。
 *   通知はステージの名前を持たない（ADR 0042。クライアントは地図のデータだけを受け取る）
 * - 平屋の glb（docs/assets.md）の襖は、「操作軸」のノードの下に、内側の板2枚・外側の板2枚・枠を
 *   持つ。操作軸の開口（中心・幅・向き）と、通知の襖の辺を、境の線と範囲で対応づける
 * - 開いた襖は、板を全部隠し、枠は残す（fusumaView.ts。判定と同じく、見た目も全幅が開く）
 * - いつも開いている片開き戸（室内の3つ）は、丁番を軸に 90 度回して、開いた姿で置く
 * - 床の高さ（体の足もと）は、glb から測った表で、立っているマスから引く（floorHeight）
 */

import type { Point } from "./rules";
import { type StageGrid, edgeKey } from "./stage";

/** 平屋の通知の形（server の hiraya.gleam と同じ値）。 */
const HIRAYA_SHAPE = {
	cellSize: 0.3,
	width: 41,
	depth: 45,
	origin: { x: -6.225, z: -0.275 },
	spawn: { x: 4.7, z: 11.3 },
} as const;

const EPSILON = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/** ステージの通知が、平屋の地図か。 */
export function isHirayaStage(grid: StageGrid): boolean {
	return (
		same(grid.cellSize, HIRAYA_SHAPE.cellSize) &&
		grid.width === HIRAYA_SHAPE.width &&
		grid.depth === HIRAYA_SHAPE.depth &&
		same(grid.origin.x, HIRAYA_SHAPE.origin.x) &&
		same(grid.origin.z, HIRAYA_SHAPE.origin.z) &&
		same(grid.spawn.x, HIRAYA_SHAPE.spawn.x) &&
		same(grid.spawn.z, HIRAYA_SHAPE.spawn.z)
	);
}

/** 襖の操作軸（2枚戸・4枚戸の引違い戸と、腰付障子）。欄間・玄関の戸は含めない。 */
const FUSUMA_AXIS = /^(ドア 引違い戸( 4枚戸)?|腰付障子 引違い戸 4枚戸) 操作軸/;

/** いつも開いている片開き戸の操作軸（室内の3つ。勝手口はいつも閉じているので含めない）。 */
const HINGED_AXIS = /^ドア 片開き戸 室内 操作軸/;

export function isFusumaAxis(name: string): boolean {
	return FUSUMA_AXIS.test(name);
}

export function isHingedAxis(name: string): boolean {
	return HINGED_AXIS.test(name);
}

/**
 * 片開き戸を開く向き（回した後の板が、戸の線の z の正の側に来るか負の側か）。
 * 部屋の側へ開く想定で決めた値で、目視で確かめて直す（issue-46 の報告）。
 */
export const HINGED_SWING: Readonly<Record<string, 1 | -1>> = {
	// 風呂-洗面所: 洗面所（z の正の側）へ開く。
	"ドア 片開き戸 室内 操作軸-001 w76": 1,
	// 洗面所-東の廊下: 洗面所（z の負の側）へ開く。
	"ドア 片開き戸 室内 操作軸-001 w86.001": -1,
	// トイレ-東の廊下: トイレ（z の負の側）へ開く。
	"ドア 片開き戸 室内 操作軸-001 w86": -1,
};

/** 戸の開口。axis は長辺の向き（"x" なら、境は z が一定の線）。x・z は中心、width は長辺の幅。 */
export interface Opening {
	readonly name: string;
	readonly axis: "x" | "z";
	readonly x: number;
	readonly z: number;
	readonly width: number;
}

/** 開口の線から、境の線までの許容（1マスの大きさ。壁の中心線は 0.125 m 以内で格子に乗る）。 */
const LINE_TOLERANCE = 0.3;

/**
 * 襖の開口ごとに、その下にある通知の襖の辺（edgeKey）を並べる。辺は、境の線が開口の線から
 * 0.3 m 以内にあり、辺の中点が開口の幅の内側にあるもの。
 */
export function matchFusuma(
	openings: readonly Opening[],
	grid: StageGrid,
): Map<string, string[]> {
	const fusuma = grid.doorList.filter((door) => door.kind === "fusuma");
	const result = new Map<string, string[]>();
	for (const opening of openings) {
		const keys: string[] = [];
		for (const { a, b } of fusuma) {
			// 上下に並ぶマスの境は z が一定の線（x 方向の開口に当たる）。
			const horizontal = a.x === b.x;
			if (horizontal !== (opening.axis === "x")) continue;
			const line = horizontal
				? grid.origin.z + grid.cellSize * Math.max(a.z, b.z)
				: grid.origin.x + grid.cellSize * Math.max(a.x, b.x);
			const mid = horizontal
				? grid.origin.x + grid.cellSize * (a.x + 0.5)
				: grid.origin.z + grid.cellSize * (a.z + 0.5);
			const openingLine = horizontal ? opening.z : opening.x;
			const openingCenter = horizontal ? opening.x : opening.z;
			if (Math.abs(line - openingLine) > LINE_TOLERANCE) continue;
			if (Math.abs(mid - openingCenter) > opening.width / 2) continue;
			keys.push(edgeKey(a, b));
		}
		result.set(opening.name, keys);
	}
	return result;
}

/** 襖のノードを開けた位置に置くか。対応する辺のどれかが開いていれば開ける。 */
export function isOpenOpening(
	edges: readonly string[],
	open: ReadonlySet<string>,
): boolean {
	return edges.some((key) => open.has(key));
}

/**
 * 片開き戸を丁番で回す角度（y 軸まわり、ラジアン。three の回転と同じ向き）。回した後の板の中心が、
 * 丁番から見て z の side（正 1 / 負 -1）の側に来る向きの、90 度。x 方向の戸（平屋の片開き戸）に使う。
 */
export function swingAngle(hinge: Point, center: Point, side: 1 | -1): number {
	const arm = { x: center.x - hinge.x, z: center.z - hinge.z };
	// y 軸まわりに +90 度回すと、z は -x になる。
	const zAfterPositive = -arm.x;
	return Math.sign(zAfterPositive) === side ? Math.PI / 2 : -Math.PI / 2;
}

// --- 床の高さ（issue-46） ------------------------------------------------------------

/**
 * 領域（地図の文字）ごとの床の高さ（メートル。glb の y）。tools/floor_heights.mjs で、平屋の glb
 * （assets-src/house/hiraya-fbx.glb）の床のノード（畳・部屋床・玄関床・お風呂の床・縁側・床の間の
 * 床板と前板）の上面を、歩けるマスの中心で測り、領域ごとの最頻値を書き写したもの（手では決めない）。
 */
export const FLOOR_HEIGHTS: Readonly<Record<string, number>> = {
	".": 0.6, // 東の廊下
	":": 0.6, // 広縁
	"=": 0.55, // 縁側
	"@": 0.4, // 玄関（土間）
	A: 0.6, // 和室A
	B: 0.6, // 和室B
	C: 0.6, // 和室C
	D: 0.6, // ダイニング
	F: 0.6, // 風呂
	K: 0.6, // キッチン
	T: 0.6, // トイレ
	W: 0.6, // 洗面所
	o: 0.6, // 押入れ
};

/**
 * 領域の値と違う高さのマス（列, 行, 領域の文字, 高さ）。同じ道具の EXCEPTION の行を書き写したもの
 * （領域の値から 5 mm より離れたマス。床の間、トイレの段、勝手口の土間、玄関の上がり框の側、
 * お風呂の床の勾配）。床のノードに当たらないマス（壁の線の上）は、領域の値を使う。
 */
export const FLOOR_EXCEPTIONS: readonly (readonly [
	number,
	number,
	string,
	number,
])[] = [
	[21, 2, "K", 0.4], // 玄関床-001.002
	[22, 2, "K", 0.4], // 玄関床-001.002
	[23, 2, "K", 0.4], // 玄関床-001.002
	[37, 3, "F", 0.53], // お風呂 床-001
	[37, 13, "T", 0.8], // 部屋床-001
	[38, 13, "T", 0.8], // 部屋床-001
	[39, 13, "T", 0.8], // 部屋床-001
	[37, 14, "T", 0.8], // 部屋床-001
	[38, 14, "T", 0.8], // 部屋床-001
	[39, 14, "T", 0.8], // 部屋床-001
	[37, 15, "T", 0.8], // 部屋床-001
	[38, 15, "T", 0.515], // 部屋床-001
	[39, 15, "T", 0.8], // 部屋床-001
	[37, 16, "T", 0.8], // 部屋床-001
	[38, 16, "T", 0.664], // 部屋床-001
	[39, 16, "T", 0.8], // 部屋床-001
	[9, 21, "B", 0.72], // 床の間 床板-001
	[10, 21, "B", 0.72], // 床の間 床板-001
	[11, 21, "B", 0.72], // 床の間 床板-001
	[12, 21, "B", 0.72], // 床の間 床板-001
	[13, 21, "B", 0.72], // 床の間 床板-001
	[14, 21, "B", 0.62], // 床の間 前板-001
	[15, 21, "B", 0.62], // 床の間 前板-001
	[16, 21, "B", 0.62], // 床の間 前板-001
	[17, 21, "B", 0.62], // 床の間 前板-001
	[18, 21, "B", 0.62], // 床の間 前板-001
	[19, 21, "B", 0.62], // 床の間 前板-001
	[9, 22, "B", 0.72], // 床の間 床板-001
	[10, 22, "B", 0.72], // 床の間 床板-001
	[11, 22, "B", 0.72], // 床の間 床板-001
	[12, 22, "B", 0.72], // 床の間 床板-001
	[13, 22, "B", 0.72], // 床の間 床板-001
	[14, 22, "B", 0.62], // 床の間 前板-001
	[15, 22, "B", 0.62], // 床の間 前板-001
	[16, 22, "B", 0.62], // 床の間 前板-001
	[17, 22, "B", 0.62], // 床の間 前板-001
	[18, 22, "B", 0.62], // 床の間 前板-001
	[19, 22, "B", 0.62], // 床の間 前板-001
	[9, 23, "B", 0.62], // 床の間 前板-001
	[10, 23, "B", 0.62], // 床の間 前板-001
	[11, 23, "B", 0.62], // 床の間 前板-001
	[12, 23, "B", 0.62], // 床の間 前板-001
	[13, 23, "B", 0.62], // 床の間 前板-001
	[14, 23, "B", 0.62], // 床の間 前板-001
	[15, 23, "B", 0.62], // 床の間 前板-001
	[16, 23, "B", 0.62], // 床の間 前板-001
	[17, 23, "B", 0.62], // 床の間 前板-001
	[18, 23, "B", 0.62], // 床の間 前板-001
	[19, 23, "B", 0.62], // 床の間 前板-001
	[33, 36, "@", 0.6], // 玄関床-001
	[34, 36, "@", 0.6], // 玄関床-001
	[35, 36, "@", 0.6], // 玄関床-001
	[36, 36, "@", 0.6], // 玄関床-001
	[37, 36, "@", 0.6], // 玄関床-001
	[38, 36, "@", 0.6], // 玄関床-001
	[39, 36, "@", 0.6], // 玄関床-001
];

const exceptionAt = new Map(
	FLOOR_EXCEPTIONS.map(([x, z, , height]) => [`${x},${z}`, height]),
);

/**
 * 立っている位置の床の高さ（体の足もとの y）。平屋の glb を表示しているとき（modelShown）だけ使い、
 * 箱の表示のとき・平屋でない地図・歩けないマスでは 0。
 */
export function floorHeight(
	grid: StageGrid,
	point: Point,
	modelShown: boolean,
): number {
	if (!modelShown || !isHirayaStage(grid)) return 0;
	const cell = {
		x: Math.floor((point.x - grid.origin.x) / grid.cellSize),
		z: Math.floor((point.z - grid.origin.z) / grid.cellSize),
	};
	if (grid.regionAt(cell) === null) return 0;
	const exception = exceptionAt.get(`${cell.x},${cell.z}`);
	if (exception !== undefined) return exception;
	return FLOOR_HEIGHTS[grid.charAt(cell) ?? ""] ?? 0;
}
