import { describe, expect, it } from "vitest";
import { grade } from "../core/grade";
import { dslProgramSchema } from "../core/schema";
import type { CzzTask } from "../core/task";
import {
	type ProgramAction,
	type ProgramDraft,
	initialProgramDraft,
	programReducer,
	toProgram,
} from "./program";

function apply(...actions: ProgramAction[]): ProgramDraft {
	return actions.reduce(programReducer, initialProgramDraft);
}

describe("programReducer - 命令列の組み立て", () => {
	it("最初は空で、空のまま直列化できる", () => {
		expect(initialProgramDraft.commands).toEqual([]);
		expect(toProgram(initialProgramDraft)).toEqual({ commands: [] });
	});

	it("add は末尾に追加し、パラメータを空文字で用意する", () => {
		const draft = apply(
			{ type: "add", commandType: "SORT_ASC" },
			{ type: "add", commandType: "FILTER_BETWEEN" },
		);

		expect(draft.commands.map((c) => c.type)).toEqual([
			"SORT_ASC",
			"FILTER_BETWEEN",
		]);
		expect(draft.commands[0]?.params).toEqual({});
		expect(draft.commands[1]?.params).toEqual({ min: "", max: "" });
	});

	it("追加した命令には重複しない id が振られる", () => {
		const draft = apply(
			{ type: "add", commandType: "SORT_ASC" },
			{ type: "add", commandType: "SORT_ASC" },
		);
		const [a, b] = draft.commands;
		expect(a?.id).not.toBe(b?.id);
	});

	it("削除した後に追加しても id が重複しない", () => {
		const added = apply(
			{ type: "add", commandType: "SORT_ASC" },
			{ type: "add", commandType: "SORT_DESC" },
		);
		const firstId = added.commands[0]?.id ?? -1;
		const draft = [
			{ type: "remove", id: firstId } as const,
			{ type: "add", commandType: "OUTPUT_SUM" } as const,
		].reduce(programReducer, added);

		const ids = draft.commands.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("setParam は指定した命令のパラメータだけを書き換える", () => {
		const added = apply(
			{ type: "add", commandType: "MAP_ADD" },
			{ type: "add", commandType: "MAP_ADD" },
		);
		const target = added.commands[1]?.id ?? -1;
		const draft = programReducer(added, {
			type: "setParam",
			id: target,
			key: "value",
			value: "10",
		});

		expect(draft.commands[0]?.params).toEqual({ value: "" });
		expect(draft.commands[1]?.params).toEqual({ value: "10" });
	});

	it("setParam は命令が持たないパラメータを無視する", () => {
		const added = apply({ type: "add", commandType: "MAP_ADD" });
		const id = added.commands[0]?.id ?? -1;
		const draft = programReducer(added, {
			type: "setParam",
			id,
			key: "min",
			value: "1",
		});

		expect(draft.commands[0]?.params).toEqual({ value: "" });
	});

	it("remove は指定した命令だけを取り除く", () => {
		const added = apply(
			{ type: "add", commandType: "SORT_ASC" },
			{ type: "add", commandType: "OUTPUT_FIRST" },
		);
		const draft = programReducer(added, {
			type: "remove",
			id: added.commands[0]?.id ?? -1,
		});

		expect(draft.commands.map((c) => c.type)).toEqual(["OUTPUT_FIRST"]);
	});

	it("clear は命令をすべて取り除く", () => {
		const draft = [{ type: "clear" } as const].reduce(
			programReducer,
			apply({ type: "add", commandType: "SORT_ASC" }),
		);
		expect(draft.commands).toEqual([]);
	});

	it("元の状態を書き換えない", () => {
		const before = apply({ type: "add", commandType: "MAP_ADD" });
		const snapshot = structuredClone(before);
		programReducer(before, {
			type: "setParam",
			id: before.commands[0]?.id ?? -1,
			key: "value",
			value: "3",
		});
		programReducer(before, { type: "add", commandType: "SORT_ASC" });
		expect(before).toEqual(snapshot);
	});
});

describe("toProgram - DslProgram への直列化", () => {
	it("パラメータが空の命令が残っていれば null を返す（採点させない）", () => {
		const draft = apply(
			{ type: "add", commandType: "SORT_ASC" },
			{ type: "add", commandType: "MAP_ADD" },
		);
		expect(toProgram(draft)).toBeNull();
	});

	it("数値にならないパラメータがあれば null を返す", () => {
		const added = apply({ type: "add", commandType: "FILTER_GT" });
		const draft = programReducer(added, {
			type: "setParam",
			id: added.commands[0]?.id ?? -1,
			key: "value",
			value: "abc",
		});
		expect(toProgram(draft)).toBeNull();
	});

	it("パラメータを数値にして、並べた順に命令を並べる", () => {
		const added = apply(
			{ type: "add", commandType: "FILTER_BETWEEN" },
			{ type: "add", commandType: "OUTPUT_SUM" },
		);
		const id = added.commands[0]?.id ?? -1;
		const draft = [
			{ type: "setParam", id, key: "min", value: "2" } as const,
			{ type: "setParam", id, key: "max", value: "4" } as const,
		].reduce(programReducer, added);

		const program = toProgram(draft);
		expect(program).toEqual({
			commands: [
				{ type: "FILTER_BETWEEN", min: 2, max: 4 },
				{ type: "OUTPUT_SUM" },
			],
		});
		expect(dslProgramSchema.safeParse(program).success).toBe(true);
	});

	it("組み立てたプログラムをそのまま採点に渡せる", () => {
		const task: CzzTask = {
			id: "t",
			title: "10を足して合計",
			description: "",
			referenceProgram: { commands: [] },
			testCases: [{ input: [0, 1], expected: [21] }],
		};
		const added = apply(
			{ type: "add", commandType: "MAP_ADD" },
			{ type: "add", commandType: "OUTPUT_SUM" },
		);
		const draft = programReducer(added, {
			type: "setParam",
			id: added.commands[0]?.id ?? -1,
			key: "value",
			value: "10",
		});

		expect(grade(toProgram(draft), task)).toMatchObject({
			valid: true,
			allPassed: true,
		});
	});
});
