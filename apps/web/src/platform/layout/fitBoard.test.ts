import { describe, expect, it } from "vitest";
import { fitCell } from "./fitBoard";

describe("fitCell - 盤の 1 マスの大きさ（見える領域から決める）", () => {
	it("テ〇〇ス（10 × 20）: min(幅 ÷ 10, (高さ − 操作部品) ÷ 20)", () => {
		// 幅で決まる: 300 ÷ 10 = 30、(900 − 200) ÷ 20 = 35
		expect(
			fitCell({ width: 300, height: 900, reserved: 200, cols: 10, rows: 20 }),
		).toBe(30);
		// 高さで決まる: 375 ÷ 10 = 37.5、(509 − 180) ÷ 20 = 16.45
		expect(
			fitCell({ width: 375, height: 509, reserved: 180, cols: 10, rows: 20 }),
		).toBe(16);
	});

	it("端数は切り捨てる（はみ出さない）", () => {
		expect(
			fitCell({ width: 99, height: 1000, reserved: 0, cols: 10, rows: 20 }),
		).toBe(9);
	});

	it("縦長のマス（高さ ÷ 幅 = aspect）: 高さの割り当ては aspect 倍で割る", () => {
		// 二角消去（6 × 8、マスは 4:5）: 幅 360 ÷ 6 = 60、(500 − 100) ÷ (8 × 1.25) = 40
		expect(
			fitCell({
				width: 360,
				height: 500,
				reserved: 100,
				cols: 6,
				rows: 8,
				aspect: 1.25,
			}),
		).toBe(40);
	});

	it("マスどうしの隙間を引いてから割る", () => {
		// 幅 (300 − 9 × 2) ÷ 10 = 28.2、高さは十分
		expect(
			fitCell({
				width: 300,
				height: 2000,
				reserved: 0,
				cols: 10,
				rows: 20,
				gap: 2,
			}),
		).toBe(28);
		// 高さ (400 − 19 × 2) ÷ 20 = 18.1、幅は十分
		expect(
			fitCell({
				width: 1000,
				height: 400,
				reserved: 0,
				cols: 10,
				rows: 20,
				gap: 2,
			}),
		).toBe(18);
	});

	it("上限があれば、それを超えない（大きな画面で、盤が大きくなりすぎない）", () => {
		expect(
			fitCell({
				width: 1000,
				height: 2000,
				reserved: 0,
				cols: 5,
				rows: 5,
				max: 72,
			}),
		).toBe(72);
	});

	it("場所が足りない・測れていない（0 や負）ときは 0", () => {
		expect(
			fitCell({ width: 300, height: 100, reserved: 200, cols: 10, rows: 20 }),
		).toBe(0);
		expect(
			fitCell({ width: 0, height: 0, reserved: 0, cols: 10, rows: 20 }),
		).toBe(0);
	});
});
