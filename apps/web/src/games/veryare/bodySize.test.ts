import { describe, expect, it } from "vitest";
import {
	BODY_HEIGHT,
	BODY_RADIUS,
	EYE_HEIGHT,
	EYE_HEIGHT_RATIO,
	HEAD_RADIUS,
	PLACEHOLDER_CAPSULE,
} from "./bodySize";

describe("体の大きさ（issue-56。体の高さ 1.6 m を基準にした値）", () => {
	it("体の高さは 1.6 m、太さ（半径）は 0.2 m", () => {
		expect(BODY_HEIGHT).toBe(1.6);
		expect(BODY_RADIUS).toBe(0.2);
	});

	it("目の高さ（カメラが見る点）は、体の高さの 0.8（1.28 m）", () => {
		expect(EYE_HEIGHT_RATIO).toBe(0.8);
		expect(EYE_HEIGHT).toBeCloseTo(1.28, 9);
	});

	it("仮のカプセルは、足もとから頭まで体の高さに収まる（半径 0.2、まっすぐな部分 1.2 m、中心は 0.8 m）", () => {
		expect(PLACEHOLDER_CAPSULE.radius).toBe(BODY_RADIUS);
		expect(
			PLACEHOLDER_CAPSULE.length + 2 * PLACEHOLDER_CAPSULE.radius,
		).toBeCloseTo(BODY_HEIGHT, 9);
		expect(PLACEHOLDER_CAPSULE.centerY).toBeCloseTo(BODY_HEIGHT / 2, 9);
	});
});

describe("頭の半径（ブラシの「大」の大きさ）", () => {
	it("素材の体（X Bot）の頭の幅の半分を、体の高さ 1.6 m にそろえた値（0.08 m）。体の太さより小さい", () => {
		expect(HEAD_RADIUS).toBe(0.08);
		expect(HEAD_RADIUS).toBeLessThan(BODY_RADIUS);
	});
});
