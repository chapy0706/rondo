import type { GameManifest } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { nearestIndex, playerLabel } from "./selection";

const base: GameManifest = {
	id: "x",
	title: "x",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	description: "",
	launchScreen: "shared",
};

describe("nearestIndex - 中央に最も近いカードを選択中とする", () => {
	it("中心に最も近いカードの位置を返す", () => {
		expect(nearestIndex([100, 300, 500], 310)).toBe(1);
		expect(nearestIndex([100, 300, 500], 480)).toBe(2);
	});

	it("端より外でも最寄りのカードを返す", () => {
		expect(nearestIndex([100, 300, 500], -50)).toBe(0);
		expect(nearestIndex([100, 300, 500], 900)).toBe(2);
	});

	it("等距離なら手前のカードを選ぶ", () => {
		expect(nearestIndex([100, 300], 200)).toBe(0);
	});

	it("カードが無ければ 0 を返す", () => {
		expect(nearestIndex([], 200)).toBe(0);
	});
});

describe("playerLabel - 人数の表記", () => {
	it("ソロは「ひとり」と単一人数", () => {
		expect(playerLabel(base)).toBe("ひとり 1人");
	});

	it("リアルタイムは「みんな」と人数の範囲", () => {
		expect(
			playerLabel({ ...base, kind: "realtime", minPlayers: 2, maxPlayers: 4 }),
		).toBe("みんな 2〜4人");
	});
});
