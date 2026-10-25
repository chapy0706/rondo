import { describe, expect, it } from "vitest";
import {
	CAMERA_FOV,
	CAMERA_NEAR,
	NEAR_CLEARANCE,
	nearPlaneReach,
} from "./cameraGuard";
import {
	FOV_MAX,
	PAINT_SHEET_GAP,
	REFERENCE_ASPECT,
	SIGHT_ASPECT,
	bodyTopOnView,
	clampPanel,
	controlSizes,
	fovForAspect,
	paintSheetMaxHeight,
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

describe("clampPanel - 動かしたシート（ペイントの板など）を、3D の画面の内側に収める", () => {
	const view = { width: 375, height: 450 };
	const panel = { width: 250, height: 200 };

	it("内側なら、そのまま", () => {
		expect(clampPanel({ x: 40, y: 100 }, panel, view)).toEqual({
			x: 40,
			y: 100,
		});
	});

	it("外へ出そうなら、端から 8 px の内側で止める", () => {
		expect(clampPanel({ x: -50, y: -30 }, panel, view)).toEqual({
			x: 8,
			y: 8,
		});
		expect(clampPanel({ x: 300, y: 400 }, panel, view)).toEqual({
			x: 375 - 250 - 8,
			y: 450 - 200 - 8,
		});
	});

	it("シートが画面より大きければ、左上に寄せる", () => {
		expect(
			clampPanel({ x: 100, y: 100 }, { width: 500, height: 600 }, view),
		).toEqual({ x: 8, y: 8 });
	});
});

describe("bodyTopOnView・paintSheetMaxHeight - 上に出すペイントの板（動ける隠れ側の規則）は、頭より上で止める", () => {
	/** iPhone の縦画面の、3D の画面のおよその大きさ（上部バーと状態の行を除いた残り。SE は探索の画面で測った値）。 */
	const VIEWS = [
		{ width: 375, height: 449 },
		{ width: 390, height: 560 },
		{ width: 393, height: 570 },
		{ width: 430, height: 630 },
		{ width: 402, height: 760 },
	];

	it("開けた所の三人称カメラでは、頭のてっぺんは、3D の画面の上から 35〜45% の所（画面の中央より上）", () => {
		for (const view of VIEWS) {
			const top = bodyTopOnView(view.width, view.height);
			expect(top / view.height).toBeGreaterThan(0.35);
			expect(top / view.height).toBeLessThan(0.45);
		}
	});

	it("縦横比が 3:4 の画面（縦の画角 60°）では、頭のてっぺんは上から約 39%", () => {
		expect(bodyTopOnView(300, 400) / 400).toBeCloseTo(0.389, 2);
	});

	it("板の高さの上限は、頭のてっぺんから、上の余白とすき間を引いた高さ（整数の px）", () => {
		for (const view of VIEWS) {
			const max = paintSheetMaxHeight(view.width, view.height);
			expect(Number.isInteger(max)).toBe(true);
			expect(max).toBe(
				Math.floor(
					bodyTopOnView(view.width, view.height) - 2 * PAINT_SHEET_GAP,
				),
			);
		}
	});

	it("iPhone SE の縦画面でも、板の中身（見出し・状態・道具の 2 行。約 150 px）が入る", () => {
		expect(paintSheetMaxHeight(375, 449)).toBeGreaterThanOrEqual(150);
	});

	it("大きさが分からない間（0）は、上限を付けない（null）", () => {
		expect(paintSheetMaxHeight(0, 0)).toBeNull();
	});
});
