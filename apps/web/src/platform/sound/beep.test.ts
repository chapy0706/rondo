import { describe, expect, it } from "vitest";
import { beepEnabled, beepFrequency } from "./beep";
import { SOUND_KEYS } from "./keys";

describe("開発中だけのビープ（issue-63）", () => {
	it("本番（NODE_ENV が production）では、どの条件でも無効", () => {
		for (const dev of [false, true]) {
			for (const search of ["", "?roof=1", "?sound=1&roof=1"]) {
				expect(beepEnabled({ nodeEnv: "production", dev, search })).toBe(false);
			}
		}
	});

	it("開発中は、開発用の指定か ?roof=1 のときだけ", () => {
		expect(
			beepEnabled({ nodeEnv: "development", dev: false, search: "" }),
		).toBe(false);
		expect(beepEnabled({ nodeEnv: "development", dev: true, search: "" })).toBe(
			true,
		);
		expect(
			beepEnabled({ nodeEnv: "development", dev: false, search: "?roof=1" }),
		).toBe(true);
		expect(
			beepEnabled({ nodeEnv: "test", dev: false, search: "?roof=0" }),
		).toBe(false);
	});

	it("NODE_ENV が無いときは、本番と同じく無効", () => {
		expect(
			beepEnabled({ nodeEnv: undefined, dev: true, search: "?roof=1" }),
		).toBe(false);
	});

	it("音ごとに、聞き分けられる高さ", () => {
		const heights = SOUND_KEYS.map(beepFrequency);
		expect(new Set(heights).size).toBe(SOUND_KEYS.length);
		for (const height of heights) {
			expect(height).toBeGreaterThan(100);
			expect(height).toBeLessThan(2000);
		}
	});
});
