import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import {
	BOX_OBSTACLES,
	HIRAYA_OBSTACLES,
	type Obstacles,
	cameraTopAboveFeet,
	clearance,
	peekRisks,
} from "./cameraHeight";
import { CAMERA_FULL_REACH, reachedPose } from "./cameraRig";
import { WALL_HEIGHT } from "./stageBoxes";

describe("cameraTopAboveFeet - 領域の中に収めたカメラの、足もとからの最大の高さ", () => {
	it("水平の距離 0〜最大のどこよりも低くない（約 1.916 m）", () => {
		const top = cameraTopAboveFeet();
		expect(top).toBeCloseTo(1.916, 2);
		for (let i = 0; i <= 500; i++) {
			const pose = reachedPose(
				{ x: 0, z: 0, feet: 0 },
				0,
				(CAMERA_FULL_REACH * i) / 500,
			);
			expect(pose.position.y).toBeLessThanOrEqual(top + 1e-9);
		}
	});
});

describe("peekRisks - カメラの高さが、遮るものの透かしや上端を越えるか", () => {
	const base: Obstacles = {
		floorMax: 0.6,
		wallTop: 3.3,
		fusumaTop: 2.685,
		ranmaBottom: 2.801,
	};

	it("どれより低ければ、越える条件は無い", () => {
		expect(peekRisks(base, 1.9)).toEqual([]);
	});

	it("襖の板の上端・欄間の下端・壁の上端を越えたら、それぞれ越える量を出す", () => {
		expect(peekRisks(base, 2.1)).toEqual([
			{ kind: "fusuma", over: expect.closeTo(0.015, 9) },
		]);
		expect(peekRisks(base, 2.3).map((r) => r.kind)).toEqual([
			"fusuma",
			"ranma",
		]);
		expect(peekRisks(base, 2.8).map((r) => r.kind)).toEqual([
			"wall",
			"fusuma",
			"ranma",
		]);
	});

	it("襖や欄間に接していない領域では、壁だけを見る", () => {
		expect(
			peekRisks(
				{ floorMax: 0.8, wallTop: 3.3, fusumaTop: null, ranmaBottom: null },
				2.0,
			),
		).toEqual([]);
	});
});

describe("平屋と箱の表示の判定（tools/wall_heights.mjs で測った値）", () => {
	const top = cameraTopAboveFeet();

	it("歩けるすべての領域に、遮るものの値がある", () => {
		for (const char of Object.keys(hirayaFixture.stage.regions)) {
			expect(HIRAYA_OBSTACLES[char], `領域 ${char}`).toBeDefined();
		}
	});

	it("平屋のどの領域でも、カメラの最高点は、遮るものの透かしや上端を越えない", () => {
		for (const [char, obstacles] of Object.entries(HIRAYA_OBSTACLES)) {
			expect(peekRisks(obstacles, top), `領域 ${char}`).toEqual([]);
		}
	});

	it("いちばん余裕が少ないのは和室B（床の間 0.72 m）で、襖の板の上端まで約 0.05 m", () => {
		const margins = Object.entries(HIRAYA_OBSTACLES).map(
			([char, obstacles]) => [char, clearance(obstacles, top)] as const,
		);
		const [char, least] = margins.reduce((p, q) => (q[1] < p[1] ? q : p));
		expect(char).toBe("B");
		expect(least).toBeGreaterThan(0);
		expect(least).toBeCloseTo(0.049, 2);
	});

	it("箱の表示（壁 2.4 m。閉じた襖の上は鴨居で 2.4 m までふさがる）でも、越えない", () => {
		expect(BOX_OBSTACLES.wallTop).toBe(WALL_HEIGHT);
		expect(peekRisks(BOX_OBSTACLES, top)).toEqual([]);
		expect(clearance(BOX_OBSTACLES, top)).toBeCloseTo(0.484, 2);
	});
});
