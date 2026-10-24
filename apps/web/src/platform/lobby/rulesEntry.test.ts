import type { RoomOption } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	RULES_STORAGE_KEY,
	type RulesStorage,
	rulesEntryOn,
	withRuleOptions,
} from "./rulesEntry";

function memory(initial: Record<string, string> = {}): RulesStorage & {
	readonly values: Record<string, string>;
} {
	const values = { ...initial };
	return {
		values,
		getItem: (key) => values[key] ?? null,
		setItem: (key, value) => {
			values[key] = value;
		},
	};
}

const broken: RulesStorage = {
	getItem: () => {
		throw new Error("blocked");
	},
	setItem: () => {
		throw new Error("blocked");
	},
};

describe("rulesEntryOn - 新しい規則の選択肢を出す入口（?rules=1）", () => {
	it("?rules=1 で出し、端末に覚える。次からは URL に無くても出す", () => {
		const storage = memory();
		expect(rulesEntryOn("?rules=1", storage)).toBe(true);
		expect(storage.values[RULES_STORAGE_KEY]).toBe("on");
		expect(rulesEntryOn("", storage)).toBe(true);
	});

	it("?rules=0 で解除し、覚えた値も消す", () => {
		const storage = memory({ [RULES_STORAGE_KEY]: "on" });
		expect(rulesEntryOn("?rules=0", storage)).toBe(false);
		expect(rulesEntryOn("", storage)).toBe(false);
	});

	it("覚えていなければ出さない。知らない値は無視する", () => {
		expect(rulesEntryOn("", memory())).toBe(false);
		expect(rulesEntryOn("?rules=yes", memory())).toBe(false);
		expect(rulesEntryOn("", memory({ [RULES_STORAGE_KEY]: "x" }))).toBe(false);
	});

	it("端末に覚えられなくても動く（URL の指定だけは効く）", () => {
		expect(rulesEntryOn("?rules=1", broken)).toBe(true);
		expect(rulesEntryOn("", broken)).toBe(false);
		expect(rulesEntryOn("?rules=1", null)).toBe(true);
		expect(rulesEntryOn("", null)).toBe(false);
	});
});

describe("withRuleOptions - 規則の選択肢を、最後に足す（重ねない）", () => {
	const option = (key: string): RoomOption => ({
		key,
		label: key,
		choices: [0, 1],
		default: 0,
	});

	it("無い選択肢だけを、最後に足す（旗ですでに出ているものは重ねない）", () => {
		expect(
			withRuleOptions(
				[option("cpu"), option("roaming")],
				[option("roaming"), option("spreading")],
			).map((o) => o.key),
		).toEqual(["cpu", "roaming", "spreading"]);
		expect(withRuleOptions([option("cpu")], []).map((o) => o.key)).toEqual([
			"cpu",
		]);
	});
});
