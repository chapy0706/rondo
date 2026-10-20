import { describe, expect, it } from "vitest";
import { rotateHintVisible } from "./rotateHint";

describe("rotateHintVisible - 横向きの案内（上の端の細い帯）", () => {
	it("タッチの端末を横向きにしたときだけ出す", () => {
		expect(
			rotateHintVisible({ landscape: true, coarse: true, dismissed: false }),
		).toBe(true);
		expect(
			rotateHintVisible({ landscape: false, coarse: true, dismissed: false }),
		).toBe(false);
		// パソコン（マウス）の横長の画面には出さない。
		expect(
			rotateHintVisible({ landscape: true, coarse: false, dismissed: false }),
		).toBe(false);
	});

	it("「×」で閉じたら、横向きのままでも出さない（横向きで遊びたい人を止めない）", () => {
		expect(
			rotateHintVisible({ landscape: true, coarse: true, dismissed: true }),
		).toBe(false);
	});
});
