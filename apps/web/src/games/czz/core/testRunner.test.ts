import { describe, expect, it } from "vitest";
import { dslProgramSchema, dslTestCaseSchema } from "./schema";
import { runTestCases } from "./testRunner";

const addOne = dslProgramSchema.parse({
	commands: [{ type: "MAP_ADD", value: 1 }],
});

describe("runTestCases", () => {
	it("全テストケースが成功する場合 allPassed が true になる", () => {
		const testCases = [
			{ input: [1, 2], expected: [2, 3] },
			{ input: [0], expected: [1] },
		].map((tc) => dslTestCaseSchema.parse(tc));

		const result = runTestCases(addOne, testCases);

		expect(result.allPassed).toBe(true);
		expect(result.results).toHaveLength(2);
		expect(result.results[0]?.passed).toBe(true);
	});

	it("1つでも失敗があれば allPassed が false になる", () => {
		const testCases = [
			{ input: [1], expected: [2] },
			{ input: [1], expected: [3] },
		].map((tc) => dslTestCaseSchema.parse(tc));

		const result = runTestCases(addOne, testCases);

		expect(result.allPassed).toBe(false);
		expect(result.results[1]).toEqual({
			index: 1,
			input: [1],
			expected: [3],
			actual: [2],
			passed: false,
		});
	});

	it("長さが違えば、前方が一致していても失敗とする", () => {
		const result = runTestCases(addOne, [{ input: [1, 2], expected: [2] }]);

		expect(result.allPassed).toBe(false);
	});
});
