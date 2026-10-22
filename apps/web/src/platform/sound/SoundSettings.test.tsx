import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOUND_CREDITS, SoundSettings } from "./SoundSettings";

describe("設定の「音」とクレジット（issue-63）", () => {
	it("旗が無い間（来場者の画面）は、何も描かない", () => {
		expect(renderToStaticMarkup(<SoundSettings />)).toBe("");
	});

	it("クレジットは、BGM と効果音の 2 行", () => {
		expect(
			SOUND_CREDITS.map(
				(credit) => `${credit.label}: ${credit.name} ${credit.url}`,
			),
		).toEqual([
			"BGM: こんとどぅふぇ https://conte-de-fees.com/",
			"効果音: 効果音ラボ https://soundeffect-lab.info/",
		]);
	});
});
