/**
 * 素材の体（X Bot）の大きさ・位置の補正と、ポーズの表（issue-56）。three を使わない純粋な関数。
 *
 * - 大きさ: 体の高さ（bodySize.ts の BODY_HEIGHT）÷ 基準姿勢の高さ。ポーズごとの外接箱では決めない
 *   （寝る・座る姿勢が拡大されないため）
 * - 体の座標（足もとが原点、縦の軸が x = z = 0）へ写す行列: 基準姿勢の外接箱の、足もとの高さと水平の
 *   中心を原点に寄せてから、倍率を掛ける（normalizeMatrix）
 * - ポーズの補正: そのポーズの一番低い点を床（y = 0）に、外接箱の水平の中心を体の位置にそろえる
 *   （poseOffset）。ポーズを変えたときは、段差の追従と同じ速さでなめらかに寄せる（followOffset）
 * - 描き込み面の (u, v) は、基準姿勢の頂点位置から求める（uvOfBindPoint）。タップでは、当たった
 *   三角形の3頂点の基準姿勢の位置を、重心座標で混ぜた点を使う（bindPointOfFace）。どのポーズでも、
 *   体の同じ部分は同じ (u, v) になる
 *
 * ポーズの表は、素材の配信のポーズの glb（character-poses。メッシュは持たず、scene の extras に表だけ
 * を入れたもの。tools/character_assets.mjs で作る）から読み、境で検証する（parsePoseTable）。
 */

import { VERYARE_MODEL_POSES, type VeryareModelPose } from "@rondo/contracts";
import { z } from "zod";
import { BODY_HEIGHT } from "./bodySize";
import { FOOT_SETTLE_SECONDS, followFloor } from "./feet";
import type { Vec3 } from "./paint";
import { type PaintCylinder, TORSO_CYLINDER, uvOnCylinder } from "./paintParts";

/** scene の extras（userData）の中の名前。 */
export const POSE_EXTRAS_KEY = "rondoPoses";

/** ポーズを変えたときの補正を、95% 寄せるまでの時間（秒。段差の追従と同じ）。 */
export const POSE_SETTLE_SECONDS = FOOT_SETTLE_SECONDS;

type V3 = readonly [number, number, number];
type V4 = readonly [number, number, number, number];

/** 1つのポーズ: 骨ごとの位置 t・回転 r（四元数）・大きさ s（省略は 1）と、外接箱（素材の座標）。 */
export interface PoseEntry {
	readonly t: readonly V3[];
	readonly r: readonly V4[];
	readonly s?: readonly V3[] | undefined;
	readonly min: V3;
	readonly max: V3;
}

export interface PoseTable {
	/** 基準姿勢の高さ（素材の座標。メートル）。 */
	readonly standingHeight: number;
	/** 基準姿勢の外接箱（素材の座標）。 */
	readonly bindMin: V3;
	readonly bindMax: V3;
	/** 骨の名前（t・r・s の並びと同じ）。 */
	readonly joints: readonly string[];
	readonly poses: Partial<Record<VeryareModelPose, PoseEntry>>;
}

/** 倍率（体の高さ ÷ 基準姿勢の高さ）。 */
export function bodyScale(table: PoseTable): number {
	return BODY_HEIGHT / table.standingHeight;
}

/** 基準姿勢の、足もとの高さと水平の中心（素材の座標）。 */
function bindCenter(table: PoseTable): V3 {
	return [
		(table.bindMin[0] + table.bindMax[0]) / 2,
		table.bindMin[1],
		(table.bindMin[2] + table.bindMax[2]) / 2,
	];
}

/** 素材の座標 → 体の座標の行列（列の順の 4×4）。 */
export function normalizeMatrix(table: PoseTable): number[] {
	const s = bodyScale(table);
	const [cx, cy, cz] = bindCenter(table);
	return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * cx, -s * cy, -s * cz, 1];
}

/** ポーズの補正（体の座標。素材の体の根に足す）。表に無いポーズは idle の補正。 */
export function poseOffset(table: PoseTable, pose: VeryareModelPose): Vec3 {
	const entry = table.poses[pose] ?? table.poses.idle;
	if (entry === undefined) return { x: 0, y: 0, z: 0 };
	const s = bodyScale(table);
	const [cx, cy, cz] = bindCenter(table);
	return {
		x: -s * ((entry.min[0] + entry.max[0]) / 2 - cx),
		y: -s * (entry.min[1] - cy),
		z: -s * ((entry.min[2] + entry.max[2]) / 2 - cz),
	};
}

/** いまの補正 current を、目標 target へ、dt 秒ぶん寄せる（段差の追従と同じ式）。 */
export function followOffset(
	current: Vec3,
	target: Vec3,
	dtSeconds: number,
): Vec3 {
	return {
		x: followFloor(current.x, target.x, dtSeconds),
		y: followFloor(current.y, target.y, dtSeconds),
		z: followFloor(current.z, target.z, dtSeconds),
	};
}

/** 列の順の 4×4 の行列 m を、点 p に当てる。 */
function apply(m: ArrayLike<number>, p: Vec3): Vec3 {
	const at = (i: number) => m[i] ?? 0;
	return {
		x: at(0) * p.x + at(4) * p.y + at(8) * p.z + at(12),
		y: at(1) * p.x + at(5) * p.y + at(9) * p.z + at(13),
		z: at(2) * p.x + at(6) * p.y + at(10) * p.z + at(14),
	};
}

/**
 * 基準姿勢の点 p（メッシュの座標）の、部位の円柱（既定は胴 / paintParts.ts）の上の (u, v)。frame は
 * メッシュの座標 → 体の座標の行列（体のシェーダーと同じもの）。
 */
export function uvOfBindPoint(
	frame: ArrayLike<number>,
	p: Vec3,
	cylinder: PaintCylinder = TORSO_CYLINDER,
): { readonly u: number; readonly v: number } {
	return uvOnCylinder(cylinder, apply(frame, p));
}

/** 三角形（頂点の番号 a・b・c）の基準姿勢の位置を、重心座標 bary で混ぜた点。 */
export function bindPointOfFace(
	positions: ArrayLike<number>,
	face: { readonly a: number; readonly b: number; readonly c: number },
	bary: Vec3,
): Vec3 {
	const at = (index: number, axis: number) => positions[index * 3 + axis] ?? 0;
	const mix = (axis: number) =>
		at(face.a, axis) * bary.x +
		at(face.b, axis) * bary.y +
		at(face.c, axis) * bary.z;
	return { x: mix(0), y: mix(1), z: mix(2) };
}

// --- 読む ---------------------------------------------------------------------------

const v3 = z.tuple([
	z.number().finite(),
	z.number().finite(),
	z.number().finite(),
]);
const v4 = z.tuple([
	z.number().finite(),
	z.number().finite(),
	z.number().finite(),
	z.number().finite(),
]);

const entrySchema = z.object({
	t: z.array(v3),
	r: z.array(v4),
	s: z.array(v3).optional(),
	min: v3,
	max: v3,
});

const schema = z.object({
	[POSE_EXTRAS_KEY]: z.object({
		version: z.literal(1),
		standingHeight: z.number().finite().positive(),
		bindMin: v3,
		bindMax: v3,
		joints: z.array(z.string().min(1)).min(1),
		poses: z.record(z.string(), entrySchema),
	}),
});

const KNOWN: ReadonlySet<string> = new Set(VERYARE_MODEL_POSES);

/**
 * userData を検証して、ポーズの表にする。一覧に無い識別子のポーズは捨てる。形が違う、骨の数と姿勢の
 * 数が合わない、既定の立ち姿（idle）が無いときは null。
 */
export function parsePoseTable(userData: unknown): PoseTable | null {
	const result = schema.safeParse(userData);
	if (!result.success) return null;
	const raw = result.data[POSE_EXTRAS_KEY];
	const count = raw.joints.length;
	const poses: Partial<Record<VeryareModelPose, PoseEntry>> = {};
	for (const [id, entry] of Object.entries(raw.poses)) {
		if (
			entry.t.length !== count ||
			entry.r.length !== count ||
			(entry.s !== undefined && entry.s.length !== count)
		) {
			return null;
		}
		if (KNOWN.has(id)) poses[id as VeryareModelPose] = entry;
	}
	if (poses.idle === undefined) return null;
	return {
		standingHeight: raw.standingHeight,
		bindMin: raw.bindMin,
		bindMax: raw.bindMax,
		joints: raw.joints,
		poses,
	};
}
