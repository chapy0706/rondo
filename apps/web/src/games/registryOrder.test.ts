import { describe, expect, it } from "vitest";
import { registry } from "./registry";

describe("registry - 選択画面のゲームの並び順（仕様）", () => {
	it("1番目が veryare、2番目が czz。ほかのゲームは、これまでの順のまま", () => {
		expect(registry.map((manifest) => manifest.id)).toEqual([
			"veryare",
			"czz",
			"tetris",
			"tilt-maze",
			"nikaku-keshi",
			"minichess",
		]);
	});
});
