import { describe, expect, it } from "vitest";
import {
	POSE_EXTRAS_KEY,
	POSE_SETTLE_SECONDS,
	type PoseTable,
	bindPointOfFace,
	bodyScale,
	followOffset,
	normalizeMatrix,
	parsePoseTable,
	poseOffset,
	uvOfBindPoint,
} from "./bodyPose";
import { BODY_HEIGHT } from "./bodySize";
import { FOOT_SETTLE_SECONDS } from "./feet";

/** 骨2本の、小さな表（基準姿勢の高さ 1.807、足もと y = 0、中心 x = z = 0）。 */
const table: PoseTable = {
	standingHeight: 1.807,
	bindMin: [-0.9, 0, -0.15],
	bindMax: [0.9, 1.807, 0.17],
	joints: ["mixamorig:Hips", "mixamorig:Spine"],
	poses: {
		idle: {
			t: [
				[0, 1, 0],
				[0, 0.1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[0, 0, 0, 1],
			],
			min: [-0.3, 0, -0.2],
			max: [0.3, 1.775, 0.2],
		},
		maleLaying1: {
			t: [
				[0, 0.2, 0],
				[0, 0.1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[Math.SQRT1_2, 0, 0, Math.SQRT1_2],
			],
			min: [-0.8, -0.036, 0],
			max: [0.8, 0.517, 0.34],
		},
		femaleDynamic2: {
			t: [
				[0, 1.2, 0],
				[0, 0.1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[0, 0, 0, 1],
			],
			min: [0, 0.221, -0.4],
			max: [0.28, 2.075, 0.46],
		},
	},
};

describe("bodyScale・normalizeMatrix - 体の大きさは、基準姿勢の高さで決める（issue-56）", () => {
	it("倍率は 体の高さ 1.6 m ÷ 基準姿勢の高さ 1.807 m", () => {
		expect(bodyScale(table)).toBeCloseTo(BODY_HEIGHT / 1.807, 12);
	});

	it("基準姿勢の足もとが y = 0、頭が y = 1.6、縦の軸が x = z = 0 になる行列（列の順の 4×4）", () => {
		const m = normalizeMatrix(table);
		const at = (k: number) => m[k] ?? Number.NaN;
		const apply = (p: [number, number, number]) => [
			at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12),
			at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13),
			at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14),
		];
		const feet = apply([0, 0, 0.01]);
		expect(feet[1]).toBeCloseTo(0, 12);
		expect(apply([0, 1.807, 0.01])[1]).toBeCloseTo(BODY_HEIGHT, 12);
		// 外接箱の中心（x 0、z 0.01）が、縦の軸に来る。
		expect(feet[0]).toBeCloseTo(0, 12);
		expect(feet[2]).toBeCloseTo(0, 12);
	});
});

describe("poseOffset - ポーズの足もとを床につけ、外接箱の水平の中心を体の位置にそろえる", () => {
	const s = BODY_HEIGHT / 1.807;

	it("立ち姿（一番低い点 0、中心 0）は、補正なし", () => {
		const o = poseOffset(table, "idle");
		expect(o.y).toBeCloseTo(0, 12);
		expect(o.x).toBeCloseTo(0, 12);
		expect(o.z).toBeCloseTo(-s * (0 - 0.01), 12);
	});

	it("寝る姿勢（一番低い点 -0.036）は、沈まないよう持ち上げる。拡大はしない（倍率は同じ）", () => {
		const o = poseOffset(table, "maleLaying1");
		expect(o.y).toBeCloseTo(0.036 * s, 12);
		expect(o.z).toBeCloseTo(-s * (0.17 - 0.01), 12);
	});

	it("跳ぶ姿勢（一番低い点 +0.221）は、浮かないよう下げる", () => {
		const o = poseOffset(table, "femaleDynamic2");
		expect(o.y).toBeCloseTo(-0.221 * s, 12);
		expect(o.x).toBeCloseTo(-s * 0.14, 12);
	});

	it("表に無いポーズは、既定の立ち姿（idle）の補正", () => {
		expect(poseOffset(table, "walking")).toEqual(poseOffset(table, "idle"));
	});
});

describe("followOffset - ポーズを変えたときの補正を、なめらかに寄せる（段差の追従と同じ仕組み）", () => {
	it("寄せる時間は 0.12 秒（段差の追従と同じ）。その時間で差の 95% 以上を追い、行き過ぎない", () => {
		expect(POSE_SETTLE_SECONDS).toBe(FOOT_SETTLE_SECONDS);
		const next = followOffset(
			{ x: 0, y: 0, z: 0 },
			{ x: 0.2, y: -0.4, z: 0.1 },
			POSE_SETTLE_SECONDS,
		);
		expect(next.y).toBeLessThanOrEqual(-0.4 * 0.95);
		expect(next.y).toBeGreaterThanOrEqual(-0.4);
		expect(next.x).toBeGreaterThanOrEqual(0.2 * 0.95);
		expect(next.x).toBeLessThanOrEqual(0.2);
	});

	it("時間が進まなければ動かない。十分に近ければ、目標に合わせる", () => {
		const current = { x: 0.1, y: 0.1, z: 0.1 };
		expect(followOffset(current, { x: 0, y: 0, z: 0 }, 0)).toEqual(current);
		expect(followOffset(current, { x: 0, y: 0, z: 0 }, 5)).toEqual({
			x: 0,
			y: 0,
			z: 0,
		});
	});
});

describe("基準姿勢の点から、描き込み面の (u, v)（どのポーズでも同じ場所に塗る）", () => {
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

	it("体の座標の点の u は縦の軸まわりの角度、v は足もと 0〜頭 1 の高さの割合", () => {
		expect(uvOfBindPoint(identity, { x: 0, y: 0.8, z: 0.2 })).toEqual({
			u: 0,
			v: 0.5,
		});
		const side = uvOfBindPoint(identity, { x: 0.2, y: 1.6, z: 0 });
		expect(side.u).toBeCloseTo(0.25, 12);
		expect(side.v).toBeCloseTo(1, 12);
	});

	it("行列（素材の座標 → 体の座標）を当ててから求める", () => {
		// 2 倍に縮め、y を 0.1 上げる行列。
		const m = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0.1, 0, 1];
		const uv = uvOfBindPoint(m, { x: 0, y: 1.4, z: -0.4 });
		expect(uv.u).toBeCloseTo(0.5, 12);
		expect(uv.v).toBeCloseTo((0.7 + 0.1) / BODY_HEIGHT, 12);
	});

	it("三角形の3頂点（基準姿勢の位置）を、重心座標で混ぜた点", () => {
		const positions = [0, 0, 0, 1, 0, 0, 0, 2, 0, 9, 9, 9];
		expect(
			bindPointOfFace(
				positions,
				{ a: 0, b: 1, c: 2 },
				{ x: 0.5, y: 0.25, z: 0.25 },
			),
		).toEqual({ x: 0.25, y: 0.5, z: 0 });
		expect(
			bindPointOfFace(positions, { a: 3, b: 1, c: 2 }, { x: 1, y: 0, z: 0 }),
		).toEqual({ x: 9, y: 9, z: 9 });
	});

	it("同じ基準姿勢の点は、ポーズに依らず同じ (u, v)（ポーズの補正・骨の姿勢は使わない）", () => {
		const m = normalizeMatrix(table);
		const p = { x: 0.1, y: 1.2, z: 0.05 };
		expect(uvOfBindPoint(m, p)).toEqual(
			uvOfBindPoint(normalizeMatrix(table), p),
		);
	});
});

describe("parsePoseTable - ポーズの表（ポーズの glb の scene の extras / 境で検証する）", () => {
	const wrap = (inner: unknown) => ({
		[POSE_EXTRAS_KEY]: { version: 1, ...(inner as object) },
	});

	it("形が正しければ読む。一覧に無い識別子のポーズは捨てる", () => {
		const parsed = parsePoseTable(
			wrap({ ...table, poses: { ...table.poses, moonwalk: table.poses.idle } }),
		);
		expect(parsed?.standingHeight).toBe(1.807);
		expect(Object.keys(parsed?.poses ?? {}).sort()).toEqual(
			["femaleDynamic2", "idle", "maleLaying1"].sort(),
		);
	});

	it("既定の立ち姿（idle）が無い、骨の数と姿勢の数が合わない、数でない、高さが 0 以下なら null", () => {
		const { idle: _idle, ...withoutIdle } = table.poses;
		for (const bad of [
			null,
			{},
			wrap({ ...table, poses: withoutIdle }),
			wrap({
				...table,
				poses: {
					...table.poses,
					idle: { ...table.poses.idle, t: [[0, 1, 0]] },
				},
			}),
			wrap({
				...table,
				poses: {
					...table.poses,
					idle: {
						...table.poses.idle,
						r: [
							[0, 0, 0, "1"],
							[0, 0, 0, 1],
						],
					},
				},
			}),
			wrap({ ...table, standingHeight: 0 }),
			{ [POSE_EXTRAS_KEY]: { ...table, version: 2 } },
		]) {
			expect(parsePoseTable(bad)).toBeNull();
		}
	});
});
