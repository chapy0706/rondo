import type { RoomOption } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { chooseOption, initialSettings } from "./roomOptions";

const exploration: RoomOption = {
	key: "explorationSeconds",
	label: "探索時間",
	choices: [40, 60, 80, 100, 120],
	default: 40,
};

describe("initialSettings - マニフェストの既定値で作成時の設定を用意する", () => {
	it("各選択肢の既定値を key ごとに並べる", () => {
		expect(initialSettings([exploration])).toEqual({ explorationSeconds: 40 });
	});

	it("選択肢がなければ空", () => {
		expect(initialSettings(undefined)).toEqual({});
		expect(initialSettings([])).toEqual({});
	});
});

describe("chooseOption - プルダウンで選んだ値を反映する", () => {
	it("選択肢にある値なら反映する", () => {
		expect(chooseOption({ explorationSeconds: 40 }, exploration, "80")).toEqual(
			{ explorationSeconds: 80 },
		);
	});

	it("選択肢にない値・数値でない値は無視する", () => {
		const current = { explorationSeconds: 40 };
		expect(chooseOption(current, exploration, "50")).toBe(current);
		expect(chooseOption(current, exploration, "abc")).toBe(current);
	});
});
