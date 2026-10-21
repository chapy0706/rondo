import { describe, expect, it } from "vitest";
import { isOperator, spectateSettingsToSend } from "./operator";

/**
 * 運営の画面（issue-67）。URL に ?operator=1 があるとき（実行時の判定）だけ、ロビーに観戦ルームを作る
 * トグルを出し、観戦の行を押せる。ビルド時の旗には頼らない。
 */
describe("isOperator - 運営の画面か", () => {
	it("?operator=1 のときだけ", () => {
		expect(isOperator("?operator=1")).toBe(true);
		expect(isOperator("?x=2&operator=1")).toBe(true);
		expect(isOperator("")).toBe(false);
		expect(isOperator("?operator=0")).toBe(false);
		expect(isOperator("?operator=true")).toBe(false);
		expect(isOperator("?operator")).toBe(false);
	});
});

describe("spectateSettingsToSend - 観戦ルームの作成の設定", () => {
	const options = [
		{ key: "hiderCpus", label: "隠れ CPU", choices: [1, 2, 3, 4], default: 3 },
		{
			key: "explorationSeconds",
			label: "探索時間",
			choices: [40, 60, 80, 100, 120],
			default: 100,
		},
	];

	it("spectate: 1 と、選んだ値（選んでいなければ既定）を送る。ステージは送らない（ランダム間取り）", () => {
		expect(spectateSettingsToSend(options, {})).toEqual({
			spectate: 1,
			hiderCpus: 3,
			explorationSeconds: 100,
		});
		expect(spectateSettingsToSend(options, { hiderCpus: 4 })).toEqual({
			spectate: 1,
			hiderCpus: 4,
			explorationSeconds: 100,
		});
	});

	it("選択肢に無い値と、知らない key は送らない（既定に戻す）", () => {
		expect(spectateSettingsToSend(options, { hiderCpus: 9, stage: 1 })).toEqual(
			{ spectate: 1, hiderCpus: 3, explorationSeconds: 100 },
		);
	});
});
