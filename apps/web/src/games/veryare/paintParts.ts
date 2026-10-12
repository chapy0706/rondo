/**
 * ペイントの5部位（ADR 0037 / issue-54）。three を使わない純粋な関数。
 *
 * - 部位: 胴（頭を含む）・左腕・右腕・左脚・右脚。骨の名前（Mixamo の mixamorig:）から部位を決める
 *   （partOfBone。上腕から先が腕で、肩（鎖骨）は胴）。体の頂点は、スキンの重みを部位ごとに合わせ、
 *   最も大きい部位に割り当てる（vertexParts。モデルの読み込み時に1回）
 * - 円柱: 部位ごとに、基準姿勢での軸と範囲を持つ（PaintCylinder）。面の上の位置は、円柱を回る角度 u と、
 *   軸の向きの位置 v（どちらも 0〜1 / uvOnCylinder）。胴は、これまでの体の円柱（paint.ts の uvOf）と
 *   同じ。腕は上腕の関節から一番遠い関節（指先）まで、脚は太ももの付け根から足首の真下の床まで
 *   （partCylinders）。骨が無い部位は null で、その部位の頂点は胴として描く（ADR 0037 の「胴で代用」）
 * - 描き込み面: 5部位を領域として並べた1枚のキャンバス（PAINT_ATLAS）。ストロークは、その部位の
 *   領域に描く（atlasDabs）
 *
 * 仮のカプセル（スキンの重みが無い）は、全部を胴として描く。
 */

import { VERYARE_PAINT_PARTS, type VeryarePaintPart } from "@rondo/contracts";
import type { VeryareStroke } from "@rondo/contracts";
import { BODY_HEIGHT } from "./bodySize";
import { type Dab, type Vec3, strokeDabs } from "./paint";

/** 部位の番号（シェーダーの頂点の属性と、配列の添字）。契約の一覧の順。 */
export function partIndex(part: VeryarePaintPart): number {
	return VERYARE_PAINT_PARTS.indexOf(part);
}

/**
 * 骨の名前（元の名前。"mixamorig:LeftForeArm" など）の部位。腕（上腕から指先）・脚（太ももから
 * つま先）の骨でなければ胴。肩（鎖骨。LeftShoulder）は胴にする（素材の体で、鎖骨の重みが胸の上の
 * 中央まで届き、腕にすると胸の上が腕の円柱に描かれたため）。
 */
export function partOfBone(name: string): VeryarePaintPart {
	const bare = name.slice(name.lastIndexOf(":") + 1);
	const limb = /^(Left|Right)(Arm|ForeArm|Hand.*|UpLeg|Leg|Foot|Toe.*)$/.exec(
		bare,
	);
	if (limb === null) return "torso";
	const side = limb[1] === "Left" ? "left" : "right";
	const leg = /^(UpLeg|Leg|Foot|Toe)/.test(limb[2] ?? "");
	return `${side}-${leg ? "leg" : "arm"}`;
}

/**
 * 頂点ごとの部位。skinIndex・skinWeight は頂点ごとに itemSize 個ずつ（three の skinIndex・skinWeight と
 * 同じ並び）、boneParts は骨の番号ごとの部位。重みを部位ごとに合わせ、最も大きい部位を選ぶ（同じなら
 * 一覧の先）。重みが無い頂点・範囲外の骨は胴。
 */
export function vertexParts(
	skinIndex: ArrayLike<number>,
	skinWeight: ArrayLike<number>,
	boneParts: readonly VeryarePaintPart[],
	itemSize = 4,
): VeryarePaintPart[] {
	const count = Math.floor(skinIndex.length / itemSize);
	const parts: VeryarePaintPart[] = [];
	for (let vertex = 0; vertex < count; vertex++) {
		const sums = VERYARE_PAINT_PARTS.map(() => 0);
		for (let k = 0; k < itemSize; k++) {
			const bone = skinIndex[vertex * itemSize + k] ?? -1;
			const weight = skinWeight[vertex * itemSize + k] ?? 0;
			const part = boneParts[bone];
			if (part === undefined || !(weight > 0)) continue;
			const i = partIndex(part);
			sums[i] = (sums[i] ?? 0) + weight;
		}
		let best = 0;
		for (let i = 1; i < sums.length; i++) {
			if ((sums[i] ?? 0) > (sums[best] ?? 0)) best = i;
		}
		parts.push(VERYARE_PAINT_PARTS[best] ?? "torso");
	}
	return parts;
}

// --- 円柱 ---------------------------------------------------------------------------

/**
 * 部位の円柱（体の座標。足もとが原点）。origin が v = 0 の所、axis（単位）の向きに length で v = 1。
 * u は ref（u = 0 の向き）から side（u = 0.25 の向き）へ回る角度。ref・side・axis は互いに直交する単位。
 */
export interface PaintCylinder {
	readonly origin: Vec3;
	readonly axis: Vec3;
	readonly ref: Vec3;
	readonly side: Vec3;
	readonly length: number;
}

/** 胴の円柱（これまでの体の円柱。正面 +z が u = 0、+x が u = 0.25、足もとが v = 0）。 */
export const TORSO_CYLINDER: PaintCylinder = {
	origin: { x: 0, y: 0, z: 0 },
	axis: { x: 0, y: 1, z: 0 },
	ref: { x: 0, y: 0, z: 1 },
	side: { x: 1, y: 0, z: 0 },
	length: BODY_HEIGHT,
};

const sub = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.x - b.x,
	y: a.y - b.y,
	z: a.z - b.z,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, s: number): Vec3 => ({
	x: a.x * s,
	y: a.y * s,
	z: a.z * s,
});
const cross = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x,
});
const length = (a: Vec3) => Math.sqrt(dot(a, a));

/** 体の座標の点 p の、円柱の上の (u, v)。v は 0〜1 に止める。体のシェーダーと同じ式。 */
export function uvOnCylinder(
	cylinder: PaintCylinder,
	p: Vec3,
): { readonly u: number; readonly v: number } {
	const d = sub(p, cylinder.origin);
	const along = dot(d, cylinder.axis) / cylinder.length;
	const turn =
		Math.atan2(dot(d, cylinder.side), dot(d, cylinder.ref)) / (2 * Math.PI);
	return { u: turn - Math.floor(turn), v: Math.min(1, Math.max(0, along)) };
}

/**
 * start（根元。v = 0）から end（先。v = 1）への円柱。u = 0 は、体の前（+z）を軸に直交するように
 * 寄せた向き（軸が前後を向くときは、上 +y）。長さが 0 なら null。
 */
export function limbCylinder(start: Vec3, end: Vec3): PaintCylinder | null {
	const span = sub(end, start);
	const size = length(span);
	if (!(size > 1e-6)) return null;
	const axis = scale(span, 1 / size);
	const perpendicular = (v: Vec3) => sub(v, scale(axis, dot(v, axis)));
	let ref = perpendicular({ x: 0, y: 0, z: 1 });
	if (length(ref) < 1e-3) ref = perpendicular({ x: 0, y: 1, z: 0 });
	ref = scale(ref, 1 / length(ref));
	return { origin: start, axis, ref, side: cross(axis, ref), length: size };
}

export type PartCylinders = {
	readonly [P in VeryarePaintPart]: PaintCylinder | null;
};

/**
 * 骨の位置（基準姿勢、体の座標。元の名前ごと）から、5部位の円柱。胴はいつも TORSO_CYLINDER。腕は
 * 上腕の関節から、その腕の一番遠い関節まで。脚は太ももの付け根から、足首の真下の床
 * （y = 0）まで。骨が足りない部位は null。
 */
export function partCylinders(
	joints: ReadonlyMap<string, Vec3>,
): PartCylinders {
	const find = (bare: string) => {
		for (const [name, p] of joints) {
			if (name.slice(name.lastIndexOf(":") + 1) === bare) return p;
		}
		return undefined;
	};
	const arm = (side: "Left" | "Right", part: VeryarePaintPart) => {
		const start = find(`${side}Arm`);
		if (start === undefined) return null;
		let end: Vec3 | null = null;
		for (const [name, p] of joints) {
			if (partOfBone(name) !== part) continue;
			if (end === null || length(sub(p, start)) > length(sub(end, start))) {
				end = p;
			}
		}
		return end === null ? null : limbCylinder(start, end);
	};
	const leg = (side: "Left" | "Right") => {
		const start = find(`${side}UpLeg`);
		const foot = find(`${side}Foot`);
		if (start === undefined || foot === undefined) return null;
		return limbCylinder(start, { x: foot.x, y: 0, z: foot.z });
	};
	return {
		torso: TORSO_CYLINDER,
		"left-arm": arm("Left", "left-arm"),
		"right-arm": arm("Right", "right-arm"),
		"left-leg": leg("Left"),
		"right-leg": leg("Right"),
	};
}

// --- 描き込み面 -----------------------------------------------------------------------

/** 描き込み面の中の、部位の領域（ピクセル。左上が原点）。 */
export interface AtlasRegion {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/**
 * 5部位を並べた描き込み面（256 × 256）。上半分が胴（これまでの描き込み面と同じ 256 × 128）、下半分を
 * 4つに分けて、左腕・右腕・左脚・右脚（それぞれ 64 × 128）。
 */
export const PAINT_ATLAS: {
	readonly width: number;
	readonly height: number;
	readonly regions: { readonly [P in VeryarePaintPart]: AtlasRegion };
} = {
	width: 256,
	height: 256,
	regions: {
		torso: { x: 0, y: 0, w: 256, h: 128 },
		"left-arm": { x: 0, y: 128, w: 64, h: 128 },
		"right-arm": { x: 64, y: 128, w: 64, h: 128 },
		"left-leg": { x: 128, y: 128, w: 64, h: 128 },
		"right-leg": { x: 192, y: 128, w: 64, h: 128 },
	},
};

/** 描き込み面に描く楕円と、切り取る領域（部位の領域からはみ出さない）。 */
export interface AtlasDab extends Dab {
	readonly clip: AtlasRegion;
}

/** ストロークを、描き込み面（PAINT_ATLAS）の、部位の領域に描く楕円の一覧にする。描く順はストロークの順。 */
export function atlasDabs(strokes: readonly VeryareStroke[]): AtlasDab[] {
	return strokes.flatMap((stroke) => {
		const clip = PAINT_ATLAS.regions[stroke.part] ?? PAINT_ATLAS.regions.torso;
		return strokeDabs([stroke], clip.w, clip.h).map((dab) => ({
			...dab,
			x: dab.x + clip.x,
			y: dab.y + clip.y,
			clip,
		}));
	});
}
