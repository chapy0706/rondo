import { describe, expect, it } from "vitest";
import {
	chooseOption,
	initialSettings,
	settingsToSend,
	visibleOptions,
} from "../../platform/lobby/roomOptions";
import {
	HIRAYA_READY,
	roofToggleAllowed,
	veryareHiddenOptions,
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

	it("素材の配信がつながったので、本番の選択肢に、ステージ（ランダム間取り / 平屋）を出す", () => {
		expect(HIRAYA_READY).toBe(true);
		// テストの環境では NEXT_PUBLIC_VERYARE_HIRAYA を付けないが、旗だけで出る。
		expect(veryareManifest.roomOptions?.[0]?.key).toBe("stage");
		// 新しい規則（隠れ側の動き・ルール / ADR 0053）も、旗で全員に出す（roaming.test.ts）。
		expect(veryareManifest.roomOptions).toEqual(
			veryareRoomOptions(true, true, true),
		);
	});
});

describe("veryareHiddenOptions - 平屋では、CPU の選択肢を出さない（サーバーが断る組み合わせを作らない）", () => {
	const options = veryareRoomOptions(true);
	const option = (key: string) => {
		const found = options.find((o) => o.key === key);
		if (found === undefined) throw new Error(`選択肢 ${key} が無い`);
		return found;
	};

	/** 宣言された選択肢の、すべての値の組み合わせ（手元の状態として、ありうるもの）。 */
	function allSettings(): Record<string, number>[] {
		return options.reduce<Record<string, number>[]>(
			(acc, o) =>
				acc.flatMap((s) => o.choices.map((c) => ({ ...s, [o.key]: c }))),
			[{}],
		);
	}

	it("平屋（stage 1）なら、隠れ側 CPU と鬼 CPU の強さを出さない。ランダム間取りなら、すべて出す", () => {
		expect(veryareHiddenOptions({ stage: 1 })).toEqual(["cpu", "cpuStrength"]);
		expect(veryareHiddenOptions({ stage: 0 })).toEqual([]);
		expect(veryareHiddenOptions({})).toEqual([]);
		const shown = (stage: number) =>
			visibleOptions(options, veryareHiddenOptions({ stage })).map(
				(o) => o.key,
			);
		expect(shown(1)).toEqual(["stage", "explorationSeconds"]);
		expect(shown(0)).toEqual([
			"stage",
			"explorationSeconds",
			"cpu",
			"cpuStrength",
		]);
	});

	it("どの選び方でも、送る設定は、平屋と CPU の組み合わせにならない", () => {
		const all = allSettings();
		expect(all).toHaveLength(2 * 5 * 5 * 3);
		for (const settings of all) {
			const sent = settingsToSend(
				options,
				settings,
				veryareHiddenOptions(settings),
			);
			if (sent.stage === 1) expect(sent.cpu).toBe(0);
		}
	});

	it("平屋からランダム間取りへ戻すと、前に選んでいた CPU の選択肢が、そのまま使える", () => {
		let settings = initialSettings(options);
		settings = chooseOption(settings, option("cpu"), "4");
		settings = chooseOption(settings, option("cpuStrength"), "2");
		settings = chooseOption(settings, option("stage"), "1");
		expect(
			settingsToSend(options, settings, veryareHiddenOptions(settings)),
		).toMatchObject({ stage: 1, cpu: 0 });
		settings = chooseOption(settings, option("stage"), "0");
		expect(
			settingsToSend(options, settings, veryareHiddenOptions(settings)),
		).toEqual({ stage: 0, explorationSeconds: 40, cpu: 4, cpuStrength: 2 });
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
