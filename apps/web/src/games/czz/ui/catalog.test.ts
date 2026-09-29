import { describe, expect, it } from "vitest";
import { dslCommandSchema } from "../core/schema";
import { czzTasks } from "../data/tasks";
import { eligibleTasks } from "../session";
import { catalog, getCatalogItem, parseParam } from "./catalog";

describe("catalog - 命令の表示と数値パラメータの定義", () => {
	it("命令の種類が重複しない", () => {
		const types = catalog.map((item) => item.type);
		expect(new Set(types).size).toBe(types.length);
	});

	it.each(catalog)(
		"$type: パラメータを埋めれば DSL のスキーマを満たす",
		(item) => {
			const command = Object.fromEntries([
				["type", item.type],
				...item.params.map((p) => [p.key, 1]),
			]);
			expect(dslCommandSchema.safeParse(command).success).toBe(true);
		},
	);

	it("getCatalogItem は種類から項目を引ける", () => {
		expect(getCatalogItem("SORT_ASC")?.label).toBe("小さい順に並べる");
	});

	it.each(eligibleTasks(czzTasks))(
		"$title: 模範解答が使う命令がすべてカタログにある",
		(task) => {
			for (const command of task.referenceProgram.commands) {
				expect(getCatalogItem(command.type)).toBeDefined();
			}
		},
	);
});

describe("parseParam - 入力欄の文字列を数値にする", () => {
	it.each([
		["10", 10],
		["0", 0],
		[" 3 ", 3],
		["-2", -2],
		["1.5", 1.5],
	])("%j は %d になる", (raw, expected) => {
		expect(parseParam(raw)).toBe(expected);
	});

	it.each(["", "  ", "abc", "1e3", "１", "1.", "--1"])(
		"%j は数値として受け付けない",
		(raw) => {
			expect(parseParam(raw)).toBeNull();
		},
	);
});
