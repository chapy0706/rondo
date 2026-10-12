import { describe, expect, it } from "vitest";
import {
	CEILING_STORAGE_KEY,
	loadCeiling,
	roofNodeVisible,
	saveCeiling,
	stageCeilingVisible,
} from "./ceilingSetting";

/** localStorage の代わり。 */
function memory(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
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
};

describe("天井のあり・なし（端末に覚える）", () => {
	it("既定は「あり」。覚えた値が「なし」のときだけ、なし", () => {
		expect(loadCeiling(memory())).toBe(true);
		expect(loadCeiling(memory({ [CEILING_STORAGE_KEY]: "off" }))).toBe(false);
		expect(loadCeiling(memory({ [CEILING_STORAGE_KEY]: "on" }))).toBe(true);
		expect(loadCeiling(memory({ [CEILING_STORAGE_KEY]: "?" }))).toBe(true);
	});

	it("覚えた値を、次に読める", () => {
		const storage = memory();
		saveCeiling(storage, false);
		expect(storage.values.get(CEILING_STORAGE_KEY)).toBe("off");
		expect(loadCeiling(storage)).toBe(false);
		saveCeiling(storage, true);
		expect(loadCeiling(storage)).toBe(true);
	});

	it("使えない（無い・例外を投げる）ときも動く。読めなければ既定の「あり」", () => {
		expect(loadCeiling(null)).toBe(true);
		expect(loadCeiling(broken)).toBe(true);
		expect(() => saveCeiling(broken, false)).not.toThrow();
		expect(() => saveCeiling(null, false)).not.toThrow();
	});
});

describe("天井と屋根の見え方", () => {
	it("ランダム間取りの天井は、設定のとおり（箱の表示でも、材質を貼った箱でも）", () => {
		expect(stageCeilingVisible(true)).toBe(true);
		expect(stageCeilingVisible(false)).toBe(false);
	});

	it("平屋の屋根と天井の glb: 天井のノードは設定のとおり、屋根のノードは開発用の屋根の切り替えのとおり", () => {
		const names = [
			"天井 室内 1階2-001",
			"天井 室内 1階-001",
			"寄棟屋根 操作軸-010",
		];
		const visible = (roof: boolean, ceiling: boolean) =>
			names.map((name) => roofNodeVisible(name, roof, ceiling));
		expect(visible(false, true)).toEqual([true, true, false]);
		expect(visible(false, false)).toEqual([false, false, false]);
		expect(visible(true, false)).toEqual([false, false, true]);
		expect(visible(true, true)).toEqual([true, true, true]);
	});
});
