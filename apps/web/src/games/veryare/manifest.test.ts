import { describe, expect, it } from "vitest";
import {
	HIRAYA_READY,
	roofToggleAllowed,
	veryareManifest,
	veryareRoomOptions,
} from "./manifest";

describe("veryareRoomOptions - ステージの選択肢（issue-46）", () => {
	it("平屋を出すときは、先頭にステージ（ランダム間取り / 平屋）を足す。既定はランダム間取り", () => {
		const [stage, ...rest] = veryareRoomOptions(true);
		expect(stage).toEqual({
			key: "stage",
			label: "ステージ",
			choices: [0, 1],
			default: 0,
			choiceLabels: { 0: "ランダム間取り", 1: "平屋" },
		});
		expect(rest).toEqual(veryareRoomOptions(false));
	});

	it("平屋を出さないときは、ステージの選択肢を出さない（ほかの選択肢はそのまま）", () => {
		const options = veryareRoomOptions(false);
		expect(options.map((o) => o.key)).toEqual([
			"explorationSeconds",
			"cpu",
			"cpuStrength",
		]);
	});

	it("見通しの一般化（issue-45）が通るまでは、本番の選択肢に平屋を出さない", () => {
		expect(HIRAYA_READY).toBe(false);
		// テストの環境では NEXT_PUBLIC_VERYARE_HIRAYA を付けないので、出ない。
		expect(veryareManifest.roomOptions?.map((o) => o.key)).not.toContain(
			"stage",
		);
	});
});

describe("roofToggleAllowed - 屋根の切り替えボタンは開発用だけ（issue-46）", () => {
	it("開発用の環境変数か、URL の ?roof=1 のときだけ出す", () => {
		expect(roofToggleAllowed(true, "")).toBe(true);
		expect(roofToggleAllowed(false, "?roof=1")).toBe(true);
		expect(roofToggleAllowed(false, "?a=b&roof=1")).toBe(true);
	});

	it("本番の既定（変数なし・URL の指定なし）では出さない", () => {
		expect(roofToggleAllowed(false, "")).toBe(false);
		expect(roofToggleAllowed(false, "?roof=0")).toBe(false);
		expect(roofToggleAllowed(false, "?roof")).toBe(false);
	});
});
