import { describe, expect, it } from "vitest";
import { spectateRoomOptions } from "./registry";

/** 観戦ルームの作成の設定（issue-67）。veryare だけが持つ。ステージは、ランダム間取りだけ（選ばせない）。 */
describe("spectateRoomOptions - 観戦ルームの作成の設定", () => {
	it("veryare: 隠れ CPU の数（hiderCpus。1〜4、既定 3）と、探索の時間（既定 100 秒）", () => {
		const options = spectateRoomOptions("veryare");
		expect(options?.map((o) => [o.key, o.choices, o.default])).toEqual([
			["hiderCpus", [1, 2, 3, 4], 3],
			["explorationSeconds", [40, 60, 80, 100, 120], 100],
		]);
		expect(options?.some((o) => o.key === "stage")).toBe(false);
	});

	it("ほかのゲームは、観戦ルームを持たない", () => {
		expect(spectateRoomOptions("tetris")).toBeNull();
	});
});
