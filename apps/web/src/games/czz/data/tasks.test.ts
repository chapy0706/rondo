import { describe, expect, it } from "vitest";
import { grade } from "../core/grade";
import { dslProgramSchema, dslTestCaseSchema } from "../core/schema";
import { czzTasks } from "./tasks";

describe("czzTasks - 静的なお題データ", () => {
	it("20問ある", () => {
		expect(czzTasks).toHaveLength(20);
	});

	it("id が重複しない", () => {
		const ids = czzTasks.map((task) => task.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(czzTasks)("$title: スキーマに合致する", (task) => {
		expect(dslProgramSchema.safeParse(task.referenceProgram).success).toBe(
			true,
		);
		expect(dslTestCaseSchema.array().safeParse(task.testCases).success).toBe(
			true,
		);
	});

	it.each(czzTasks)("$title: 模範解答が全テストケースを通る", (task) => {
		const result = grade(task.referenceProgram, task);
		expect(result).toMatchObject({ valid: true, allPassed: true });
	});
});
