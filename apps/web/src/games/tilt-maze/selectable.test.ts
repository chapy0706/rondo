import { describe, expect, it } from "vitest";
import { DIFFICULTIES, SELECTABLE_DIFFICULTIES } from "./engine";

describe("選べる迷路の大きさ", () => {
	it("小と中だけ（大 11×11 は iPhone の縦画面に収まらないので、選択肢から外す / 2026-10-23）", () => {
		expect(SELECTABLE_DIFFICULTIES).toEqual(["small", "medium"]);
	});

	it("迷路を作れる大きさ（DIFFICULTIES）は変えない（あとで大を戻せる）", () => {
		for (const difficulty of SELECTABLE_DIFFICULTIES) {
			expect(DIFFICULTIES).toContain(difficulty);
		}
		expect(DIFFICULTIES).toContain("large");
	});
});
