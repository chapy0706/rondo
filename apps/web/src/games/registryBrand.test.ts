import { describe, expect, it } from "vitest";
import { registry } from "./registry";

/**
 * 登録されているゲームの表示名・説明文・ロゴ（issue-69）。内部の識別子は変えない。
 */
describe("登録の表示名とロゴ（issue-69）", () => {
	it("内部の識別子は、これまでどおり", () => {
		expect(registry.map((m) => m.id)).toEqual([
			"veryare",
			"czz",
			"tetris",
			"tilt-maze",
			"nikaku-keshi",
			"minichess",
		]);
	});

	it("決まった日本語の表示名", () => {
		expect(Object.fromEntries(registry.map((m) => [m.id, m.title]))).toEqual({
			veryare: "すごくアレ",
			czz: "指示厨ゲーム",
			tetris: "テ〇〇ス",
			"tilt-maze": "ころころ迷路",
			"nikaku-keshi": "二角消去",
			minichess: "ミニチェス",
		});
	});

	it("テ〇〇ス の〇は漢数字のゼロ（U+3007）で、読み上げと代替の文字は「落ちものパズル」", () => {
		const tetris = registry.find((m) => m.id === "tetris");
		expect(
			Array.from(tetris?.title ?? "").filter((c) => c === "〇"),
		).toHaveLength(2);
		expect(tetris?.title).not.toMatch(/[⚪○◯]/u);
		expect(tetris?.spokenTitle).toBe("落ちものパズル");
	});

	it("説明文は、カードの名前の下に出す1行（改行なし・空でない）", () => {
		for (const m of registry) {
			expect(m.description.trim()).not.toBe("");
			expect(m.description).not.toMatch(/\n/);
		}
	});

	it("どのゲームも、ロゴの背景の色（#rrggbb）を持つ。表示名は識別子と別", () => {
		for (const m of registry) {
			expect(m.logo?.background).toMatch(/^#[0-9a-f]{6}$/);
			expect(m.title).not.toBe(m.id);
		}
	});
});
