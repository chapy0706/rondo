import { describe, expect, it } from "vitest";
import { hiddenRoomOptions } from "./registry";

describe("hiddenRoomOptions - ロビーに出さない選択肢の振り分け（issue-46）", () => {
	it("veryare では、平屋のときだけ CPU の選択肢を出さない", () => {
		expect(hiddenRoomOptions("veryare", { stage: 1 })).toEqual([
			"cpu",
			"cpuStrength",
		]);
		expect(hiddenRoomOptions("veryare", { stage: 0, cpu: 4 })).toEqual([]);
	});

	it("登録の無いゲームでは、すべて出す", () => {
		expect(hiddenRoomOptions("tetris", { stage: 1 })).toEqual([]);
		expect(hiddenRoomOptions("unknown", {})).toEqual([]);
	});
});
