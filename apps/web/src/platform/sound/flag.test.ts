import { describe, expect, it } from "vitest";
import { SOUND_FLAG_KEY, SOUND_READY, resolveSoundFlag } from "./flag";

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

describe("音の旗（SOUND_READY と ?sound / issue-63）", () => {
	it("旗の既定は false（来場者の画面では、何もしない）", () => {
		expect(SOUND_READY).toBe(false);
	});

	it("何も無ければ鳴らさない", () => {
		expect(resolveSoundFlag(false, memory(), "")).toBe(false);
		expect(resolveSoundFlag(false, memory(), "?roof=1")).toBe(false);
	});

	it("?sound=1 で鳴らし、端末に覚える。次は URL が無くても鳴らす", () => {
		const storage = memory();
		expect(resolveSoundFlag(false, storage, "?sound=1")).toBe(true);
		expect(storage.values.get(SOUND_FLAG_KEY)).toBe("1");
		expect(resolveSoundFlag(false, storage, "")).toBe(true);
	});

	it("?sound=0 で解除する", () => {
		const storage = memory({ [SOUND_FLAG_KEY]: "1" });
		expect(resolveSoundFlag(false, storage, "?sound=0")).toBe(false);
		expect(storage.values.has(SOUND_FLAG_KEY)).toBe(false);
		expect(resolveSoundFlag(false, storage, "")).toBe(false);
	});

	it("旗が true なら、?sound=0 で解除していても鳴らす（覚えた値は解除のまま）", () => {
		expect(resolveSoundFlag(true, memory(), "")).toBe(true);
		expect(resolveSoundFlag(true, memory(), "?sound=0")).toBe(true);
	});

	it("localStorage が使えなくても、URL のとおりに決め、例外を出さない", () => {
		expect(resolveSoundFlag(false, broken, "?sound=1")).toBe(true);
		expect(resolveSoundFlag(false, broken, "")).toBe(false);
		expect(resolveSoundFlag(false, null, "?sound=1")).toBe(true);
	});

	it("知らない値は、覚えた値を変えない", () => {
		const storage = memory({ [SOUND_FLAG_KEY]: "1" });
		expect(resolveSoundFlag(false, storage, "?sound=yes")).toBe(true);
		expect(storage.values.get(SOUND_FLAG_KEY)).toBe("1");
	});
});
