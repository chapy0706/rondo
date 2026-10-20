import { describe, expect, it } from "vitest";
import {
	CAMERA_FOV,
	CAMERA_NEAR,
	NEAR_CLEARANCE,
	nearPlaneReach,
} from "./cameraGuard";
import {
	FOV_MAX,
	REFERENCE_ASPECT,
	SIGHT_ASPECT,
	controlSizes,
	fovForAspect,
} from "./viewLayout";

/** 縦の画角 fov（度）と横長 aspect の、横の画角（度）。 */
function horizontalFov(fov: number, aspect: number): number {
	return (
		(2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI
	);
}

describe("fovForAspect - 縦に長い画面でも、横の画角を切り詰めない", () => {
	it("これまでの 3:4 と、それより横に広い画面では、縦の画角はこれまでどおり 60°", () => {
		expect(REFERENCE_ASPECT).toBe(3 / 4);
		expect(fovForAspect(3 / 4)).toBe(CAMERA_FOV);
		expect(fovForAspect(0.85)).toBe(CAMERA_FOV);
		expect(fovForAspect(16 / 9)).toBe(CAMERA_FOV);
	});

	it("3:4 より縦に長い画面（待機ルーム・探索の 3D の画面）では、横の画角を 3:4 のときと同じにする", () => {
		const reference = horizontalFov(CAMERA_FOV, 3 / 4);
		// iPhone の縦画面の 3D の画面（上部バーと状態の行を除いた大きさ）の例。
		for (const aspect of [0.7, 0.65, 0.6, 0.56]) {
			const fov = fovForAspect(aspect);
			expect(fov).toBeGreaterThan(CAMERA_FOV);
			expect(horizontalFov(fov, aspect)).toBeCloseTo(reference, 6);
		}
	});

	it("とても縦に長い画面では、縦の画角を上限（80°）で止める", () => {
		expect(FOV_MAX).toBe(80);
		expect(fovForAspect(0.4)).toBe(FOV_MAX);
		expect(fovForAspect(0)).toBe(FOV_MAX);
	});

	it("広げても、ニアクリップの面の角は、壁の余白の計算（NEAR_CLEARANCE）を超えない", () => {
		for (const aspect of [0.3, 0.5, 0.6, 0.7, 0.75]) {
			expect(
				nearPlaneReach(CAMERA_NEAR, fovForAspect(aspect), aspect),
			).toBeLessThanOrEqual(NEAR_CLEARANCE);
		}
	});

	it("鬼の視界の判定（見逃しポイント / ADR 0036）は、画面の形に関わらず、これまでの 3:4 で見る", () => {
		expect(SIGHT_ASPECT).toBe(3 / 4);
	});
});

describe("controlSizes - パッドと撃つボタンの大きさは、3D の画面の大きさで決める", () => {
	it("iPhone の縦画面（SE〜Pro Max）では、パッドは 84〜120 px、撃つボタンは 60〜80 px", () => {
		for (const [w, h] of [
			[375, 430],
			[390, 545],
			[402, 560],
			[430, 615],
			[402, 750],
		] as const) {
			const { pad, shoot } = controlSizes(w, h);
			expect(pad).toBeGreaterThanOrEqual(84);
			expect(pad).toBeLessThanOrEqual(120);
			expect(shoot).toBeGreaterThanOrEqual(60);
			expect(shoot).toBeLessThanOrEqual(80);
			// 2 つのパッドと撃つボタンが、横に並んで収まる（余白 8 px × 4）。
			expect(pad * 2 + shoot + 32).toBeLessThanOrEqual(w);
		}
	});

	it("小さい画面ほど小さく、大きい画面では上限で止める。整数の px", () => {
		expect(controlSizes(375, 430).pad).toBeLessThan(controlSizes(430, 615).pad);
		expect(controlSizes(1000, 1000)).toEqual({ pad: 120, shoot: 80 });
		expect(controlSizes(200, 200)).toEqual({ pad: 84, shoot: 60 });
		const { pad, shoot } = controlSizes(391, 547);
		expect(Number.isInteger(pad)).toBe(true);
		expect(Number.isInteger(shoot)).toBe(true);
	});

	it("大きさが分からない間（0）は、これまでの大きさ", () => {
		expect(controlSizes(0, 0)).toEqual({ pad: 120, shoot: 80 });
	});
});
