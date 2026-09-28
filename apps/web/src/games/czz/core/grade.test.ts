import { describe, expect, it } from "vitest";
import { grade } from "./grade";
import type { CzzTask } from "./task";

const sortTask: CzzTask = {
	id: "test-sort",
	title: "昇順",
	description: "小さい順に並べる",
	referenceProgram: { commands: [{ type: "SORT_ASC" }] },
	testCases: [
		{ input: [3, 1, 2], expected: [1, 2, 3] },
		{ input: [], expected: [] },
	],
};

describe("grade - 提出されたプログラムとお題から採点する", () => {
	it("正しいプログラムなら全問正解になる", () => {
		const result = grade({ commands: [{ type: "SORT_ASC" }] }, sortTask);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.allPassed).toBe(true);
		expect(result.results).toHaveLength(2);
	});

	it("誤ったプログラムなら不正解になり、各ケースの実際の出力が返る", () => {
		const result = grade({ commands: [{ type: "SORT_DESC" }] }, sortTask);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.allPassed).toBe(false);
		expect(result.results[0]?.actual).toEqual([3, 2, 1]);
	});

	it("スキーマに合わない提出は採点せず invalid を返す", () => {
		expect(grade({ commands: [{ type: "UNKNOWN" }] }, sortTask)).toEqual({
			valid: false,
		});
		expect(grade("sort -n", sortTask)).toEqual({ valid: false });
		expect(grade(undefined, sortTask)).toEqual({ valid: false });
	});
});
