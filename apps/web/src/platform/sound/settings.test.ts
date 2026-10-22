import { describe, expect, it } from "vitest";
import {
	DEFAULT_SOUND_SETTINGS,
	SOUND_SETTINGS_KEY,
	busGains,
	loadSoundSettings,
	saveSoundSettings,
} from "./settings";

/** localStorage の代わり。 */
function memory(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		values,
	};
}

const broken = {
	getItem: (): string | null => {
		throw new Error("使えない");
	},
	setItem: (): void => {
		throw new Error("使えない");
	},
	removeItem: (): void => {
		throw new Error("使えない");
	},
};

describe("音の設定（端末に覚える / issue-63）", () => {
	it("既定は、BGM 小さめ・効果音 中くらい・ミュートなし", () => {
		expect(loadSoundSettings(memory())).toEqual(DEFAULT_SOUND_SETTINGS);
		expect(DEFAULT_SOUND_SETTINGS.bgm).toBeLessThan(DEFAULT_SOUND_SETTINGS.se);
		expect(DEFAULT_SOUND_SETTINGS.muted).toBe(false);
	});

	it("覚えた値を、次に読める", () => {
		const storage = memory();
		saveSoundSettings(storage, { bgm: 0.2, se: 0.9, muted: true });
		expect(loadSoundSettings(storage)).toEqual({
			bgm: 0.2,
			se: 0.9,
			muted: true,
		});
	});

	it("壊れた値・範囲の外の値は、既定か範囲の端に直す", () => {
		expect(
			loadSoundSettings(memory({ [SOUND_SETTINGS_KEY]: "{壊れている" })),
		).toEqual(DEFAULT_SOUND_SETTINGS);
		expect(
			loadSoundSettings(
				memory({
					[SOUND_SETTINGS_KEY]: JSON.stringify({ bgm: 3, se: -1, muted: "x" }),
				}),
			),
		).toEqual({ bgm: 1, se: 0, muted: false });
		expect(
			loadSoundSettings(
				memory({ [SOUND_SETTINGS_KEY]: JSON.stringify({ bgm: "a" }) }),
			),
		).toEqual(DEFAULT_SOUND_SETTINGS);
	});

	it("localStorage が使えなくても、既定で動き、書くときも例外を出さない", () => {
		expect(loadSoundSettings(broken)).toEqual(DEFAULT_SOUND_SETTINGS);
		expect(loadSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS);
		expect(() =>
			saveSoundSettings(broken, DEFAULT_SOUND_SETTINGS),
		).not.toThrow();
		expect(() => saveSoundSettings(null, DEFAULT_SOUND_SETTINGS)).not.toThrow();
	});

	it("系統の音量: ミュートなら全体が 0", () => {
		expect(busGains({ bgm: 0.4, se: 0.7, muted: false })).toEqual({
			master: 1,
			bgm: 0.4,
			se: 0.7,
		});
		expect(busGains({ bgm: 0.4, se: 0.7, muted: true }).master).toBe(0);
	});
});
