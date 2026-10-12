import { VERYARE_PAINT_PARTS, type VeryareStroke } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { BODY_HEIGHT } from "./bodySize";
import { uvOf } from "./paint";
import {
	PAINT_ATLAS,
	TORSO_CYLINDER,
	atlasDabs,
	limbCylinder,
	partCylinders,
	partOfBone,
	uvOnCylinder,
	vertexParts,
} from "./paintParts";

describe("partOfBone - 骨の名前から部位（上腕から先は腕。肩（鎖骨）・頭・首・背骨・腰は胴）", () => {
	it("腕: 上腕から指先まで", () => {
		for (const name of [
			"mixamorig:LeftArm",
			"mixamorig:LeftForeArm",
			"mixamorig:LeftHand",
			"mixamorig:LeftHandIndex3",
		]) {
			expect(partOfBone(name)).toBe("left-arm");
		}
		expect(partOfBone("mixamorig:RightHandThumb1")).toBe("right-arm");
		expect(partOfBone("mixamorig:RightForeArm")).toBe("right-arm");
	});

	it("脚: 太ももからつま先まで", () => {
		for (const name of [
			"mixamorig:LeftUpLeg",
			"mixamorig:LeftLeg",
			"mixamorig:LeftFoot",
			"mixamorig:LeftToeBase",
			"mixamorig:LeftToe_End",
		]) {
			expect(partOfBone(name)).toBe("left-leg");
		}
		expect(partOfBone("mixamorig:RightUpLeg")).toBe("right-leg");
	});

	it("それ以外（肩（鎖骨）・腰・背骨・首・頭・目・知らない骨）は胴。接頭辞が無くてもよい", () => {
		for (const name of [
			"mixamorig:LeftShoulder",
			"mixamorig:RightShoulder",
			"mixamorig:Hips",
			"mixamorig:Spine2",
			"mixamorig:Neck",
			"mixamorig:Head",
			"mixamorig:LeftEye",
			"Root",
			"",
		]) {
			expect(partOfBone(name)).toBe("torso");
		}
		expect(partOfBone("LeftForeArm")).toBe("left-arm");
	});
});

describe("vertexParts - 頂点ごとに、スキンの重みが最も大きい部位", () => {
	const bones = ["torso", "left-arm", "left-arm", "right-leg"] as const;

	it("1本の骨だけに付く頂点は、その骨の部位", () => {
		expect(
			vertexParts([0, 0, 0, 0, 3, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0], bones),
		).toEqual(["torso", "right-leg"]);
	});

	it("重みは部位ごとに合わせて比べる（同じ部位の骨2本の合計が勝つ）", () => {
		// 胴 0.4、左腕 0.3 + 0.3。
		expect(vertexParts([0, 1, 2, 0], [0.4, 0.3, 0.3, 0], bones)).toEqual([
			"left-arm",
		]);
	});

	it("同じ重みなら、部位の一覧の先（胴）を選ぶ。重みが無い・骨が範囲外の頂点は胴", () => {
		expect(vertexParts([0, 3, 0, 0], [0.5, 0.5, 0, 0], bones)).toEqual([
			"torso",
		]);
		expect(vertexParts([1, 0, 0, 0], [0, 0, 0, 0], bones)).toEqual(["torso"]);
		expect(vertexParts([9, 0, 0, 0], [1, 0, 0, 0], bones)).toEqual(["torso"]);
	});
});

describe("uvOnCylinder - 部位の円柱の上の (u, v)", () => {
	it("胴の円柱は、これまでの体の円柱と同じ (u, v)（胴だけのペイントが同じ所に映る）", () => {
		for (const p of [
			{ x: 0, y: 0.4, z: 0.2 },
			{ x: 0.2, y: 0.8, z: 0 },
			{ x: -0.1, y: 1.2, z: -0.15 },
		]) {
			const a = uvOnCylinder(TORSO_CYLINDER, p);
			const b = uvOf(p);
			expect(a.u).toBeCloseTo(b.u, 9);
			expect(a.v).toBeCloseTo(b.v, 9);
		}
	});

	it("v は軸の向きの位置で、範囲の外は 0〜1 に止める。u は 0〜1", () => {
		expect(uvOnCylinder(TORSO_CYLINDER, { x: 0, y: -1, z: 0.1 }).v).toBe(0);
		expect(
			uvOnCylinder(TORSO_CYLINDER, { x: 0, y: BODY_HEIGHT + 1, z: 0.1 }).v,
		).toBe(1);
		const { u } = uvOnCylinder(TORSO_CYLINDER, { x: -0.1, y: 1, z: -0.0001 });
		expect(u).toBeGreaterThanOrEqual(0);
		expect(u).toBeLessThan(1);
	});
});

describe("limbCylinder - 基準姿勢の関節から、腕・脚の円柱", () => {
	it("横へ伸びた腕: 根元で v = 0、先で v = 1。前（+z）が u = 0", () => {
		const arm = limbCylinder(
			{ x: 0.1, y: 1.4, z: 0 },
			{ x: 0.8, y: 1.4, z: 0 },
		);
		if (arm === null) throw new Error("作れない");
		expect(uvOnCylinder(arm, { x: 0.1, y: 1.4, z: 0.05 }).v).toBeCloseTo(0, 9);
		expect(uvOnCylinder(arm, { x: 0.45, y: 1.4, z: 0.05 }).v).toBeCloseTo(
			0.5,
			9,
		);
		expect(uvOnCylinder(arm, { x: 0.45, y: 1.4, z: 0.05 }).u).toBeCloseTo(0, 9);
		// 前と後ろは、半周違う。
		expect(uvOnCylinder(arm, { x: 0.45, y: 1.4, z: -0.05 }).u).toBeCloseTo(
			0.5,
			9,
		);
	});

	it("下へ伸びた脚: 前（+z）が u = 0、横は 4 分の 1 周（左右で 0.25 と 0.75）", () => {
		const leg = limbCylinder({ x: 0.1, y: 0.9, z: 0 }, { x: 0.1, y: 0, z: 0 });
		if (leg === null) throw new Error("作れない");
		expect(uvOnCylinder(leg, { x: 0.1, y: 0.45, z: 0.05 }).u).toBeCloseTo(0, 9);
		const right = uvOnCylinder(leg, { x: 0.15, y: 0.45, z: 0 }).u;
		const left = uvOnCylinder(leg, { x: 0.05, y: 0.45, z: 0 }).u;
		expect([right, left].sort()).toEqual([
			expect.closeTo(0.25, 9),
			expect.closeTo(0.75, 9),
		]);
		// 上（根元）が v = 0。
		expect(uvOnCylinder(leg, { x: 0.1, y: 0.9, z: 0.05 }).v).toBeCloseTo(0, 9);
	});

	it("前後へ伸びた軸でも、向きが決まる。長さ 0 は作らない", () => {
		const forward = limbCylinder({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0.5 });
		expect(forward).not.toBeNull();
		if (forward === null) return;
		const uv = uvOnCylinder(forward, { x: 0, y: 1.05, z: 0.25 });
		expect(Number.isFinite(uv.u)).toBe(true);
		expect(uv.v).toBeCloseTo(0.5, 9);
		expect(limbCylinder({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
	});
});

describe("partCylinders - 骨の位置（体の座標）から5部位の円柱", () => {
	const joints = new Map([
		["mixamorig:Hips", { x: 0, y: 0.9, z: 0 }],
		["mixamorig:LeftShoulder", { x: 0.05, y: 1.4, z: 0 }],
		["mixamorig:LeftArm", { x: 0.15, y: 1.4, z: 0 }],
		["mixamorig:LeftHand", { x: 0.65, y: 1.4, z: 0 }],
		["mixamorig:LeftHandMiddle4", { x: 0.8, y: 1.4, z: 0 }],
		["mixamorig:LeftUpLeg", { x: 0.1, y: 0.85, z: 0 }],
		["mixamorig:LeftLeg", { x: 0.1, y: 0.45, z: 0 }],
		["mixamorig:LeftFoot", { x: 0.1, y: 0.08, z: 0 }],
		["mixamorig:LeftToeBase", { x: 0.1, y: 0.02, z: 0.12 }],
	]);

	it("胴はいつも体の円柱。腕は上腕の関節から一番遠い関節まで、脚は太ももから足首の真下の床まで", () => {
		const cylinders = partCylinders(joints);
		expect(cylinders.torso).toEqual(TORSO_CYLINDER);
		const arm = cylinders["left-arm"];
		expect(arm?.origin).toEqual({ x: 0.15, y: 1.4, z: 0 });
		expect(arm?.length).toBeCloseTo(0.65, 9);
		const leg = cylinders["left-leg"];
		expect(leg?.origin).toEqual({ x: 0.1, y: 0.85, z: 0 });
		expect(leg?.length).toBeCloseTo(0.85, 9);
	});

	it("骨が無い部位は null（その部位の頂点は胴として描く）", () => {
		const cylinders = partCylinders(joints);
		expect(cylinders["right-arm"]).toBeNull();
		expect(cylinders["right-leg"]).toBeNull();
	});
});

describe("PAINT_ATLAS / atlasDabs - 5部位を並べた1枚の描き込み面", () => {
	it("5部位の領域は重ならず、描き込み面の中に収まる。胴はこれまでと同じ大きさ（256 × 128）", () => {
		const regions = VERYARE_PAINT_PARTS.map((p) => PAINT_ATLAS.regions[p]);
		for (const r of regions) {
			expect(r.x).toBeGreaterThanOrEqual(0);
			expect(r.y).toBeGreaterThanOrEqual(0);
			expect(r.x + r.w).toBeLessThanOrEqual(PAINT_ATLAS.width);
			expect(r.y + r.h).toBeLessThanOrEqual(PAINT_ATLAS.height);
		}
		for (const [i, a] of regions.entries()) {
			for (const b of regions.slice(i + 1)) {
				const apart =
					a.x + a.w <= b.x ||
					b.x + b.w <= a.x ||
					a.y + a.h <= b.y ||
					b.y + b.h <= a.y;
				expect(apart).toBe(true);
			}
		}
		expect(PAINT_ATLAS.regions.torso).toMatchObject({ w: 256, h: 128 });
	});

	it("ストロークは、その部位の領域に描く（はみ出す楕円は領域で切る）", () => {
		const stroke = (part: VeryareStroke["part"]): VeryareStroke => ({
			part,
			color: "#123456",
			size: 0.04,
			points: [{ u: 0.5, v: 0.5 }],
		});
		const torso = atlasDabs([stroke("torso")]);
		const arm = atlasDabs([stroke("right-arm")]);
		const t = PAINT_ATLAS.regions.torso;
		const a = PAINT_ATLAS.regions["right-arm"];
		expect(torso[0]?.x).toBeCloseTo(t.x + t.w / 2, 9);
		expect(torso[0]?.y).toBeCloseTo(t.y + t.h / 2, 9);
		expect(torso[0]?.clip).toEqual(t);
		expect(arm[0]?.x).toBeCloseTo(a.x + a.w / 2, 9);
		expect(arm[0]?.y).toBeCloseTo(a.y + a.h / 2, 9);
		expect(arm[0]?.clip).toEqual(a);
		// 楕円の大きさは、その領域の幅・高さに対する割合。
		expect(arm[0]?.rx).toBeCloseTo(0.04 * a.w, 9);
		expect(arm[0]?.ry).toBeCloseTo(0.04 * a.h, 9);
	});
});
