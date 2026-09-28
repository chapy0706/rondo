import { describe, expect, it } from "vitest";
import { execute } from "./execute";
import { dslProgramSchema } from "./schema";

function run(commands: unknown[], input: number[]): number[] {
	return execute(dslProgramSchema.parse({ commands }), input);
}

describe("execute - 基本命令", () => {
	it("命令が空なら入力をそのまま返す", () => {
		expect(run([], [3, 1, 2])).toEqual([3, 1, 2]);
	});

	it("FILTER_EQUALS で指定値だけ残す", () => {
		expect(run([{ type: "FILTER_EQUALS", value: 2 }], [1, 2, 2, 3])).toEqual([
			2, 2,
		]);
	});

	it("FILTER_EQUALS は文字列数値を許容する", () => {
		expect(run([{ type: "FILTER_EQUALS", value: "2" }], [1, 2, 2, 3])).toEqual([
			2, 2,
		]);
	});

	it("FILTER_NOT_EQUALS で指定値以外を残す", () => {
		expect(
			run([{ type: "FILTER_NOT_EQUALS", value: 2 }], [1, 2, 2, 3]),
		).toEqual([1, 3]);
	});

	it("FILTER_GT は指定値より大きいものを残す", () => {
		expect(run([{ type: "FILTER_GT", value: 3 }], [1, 3, 4, 5])).toEqual([
			4, 5,
		]);
	});

	it("FILTER_LT は指定値未満を残す", () => {
		expect(run([{ type: "FILTER_LT", value: 3 }], [1, 2, 3, 4, 5])).toEqual([
			1, 2,
		]);
	});

	it("FILTER_BETWEEN は範囲内を残す", () => {
		expect(
			run([{ type: "FILTER_BETWEEN", min: 2, max: 4 }], [1, 2, 3, 4, 5]),
		).toEqual([2, 3, 4]);
	});

	it("FILTER_BETWEEN は min==max でも一致を残す", () => {
		expect(
			run([{ type: "FILTER_BETWEEN", min: 2, max: 2 }], [1, 2, 2, 3]),
		).toEqual([2, 2]);
	});

	it("MAP_ADD で値を加算する", () => {
		expect(run([{ type: "MAP_ADD", value: 10 }], [1, 2, 3])).toEqual([
			11, 12, 13,
		]);
	});

	it("MAP_MULTIPLY で値を乗算する", () => {
		expect(run([{ type: "MAP_MULTIPLY", value: 2 }], [1, -2, 3])).toEqual([
			2, -4, 6,
		]);
	});

	it("SORT_ASC で数値として昇順ソートする", () => {
		expect(run([{ type: "SORT_ASC" }], [10, 1, 2, -3])).toEqual([-3, 1, 2, 10]);
	});

	it("SORT_DESC で降順ソートする", () => {
		expect(run([{ type: "SORT_DESC" }], [3, 1, 2])).toEqual([3, 2, 1]);
	});

	it("OUTPUT_FIRST は先頭だけを配列で返す", () => {
		expect(run([{ type: "OUTPUT_FIRST" }], [7, 8, 9])).toEqual([7]);
	});

	it("OUTPUT_FIRST は空入力なら空配列を返す", () => {
		expect(run([{ type: "OUTPUT_FIRST" }], [])).toEqual([]);
	});

	it("OUTPUT_LAST は末尾だけを配列で返す", () => {
		expect(run([{ type: "OUTPUT_LAST" }], [7, 8, 9])).toEqual([9]);
	});

	it("OUTPUT_LAST は空入力なら空配列を返す", () => {
		expect(run([{ type: "OUTPUT_LAST" }], [])).toEqual([]);
	});

	it("OUTPUT_SUM で合計を返す（空なら 0）", () => {
		expect(run([{ type: "OUTPUT_SUM" }], [1, 2, 3])).toEqual([6]);
		expect(run([{ type: "OUTPUT_SUM" }], [])).toEqual([0]);
	});

	it("OUTPUT_COUNT で件数を返す", () => {
		expect(run([{ type: "OUTPUT_COUNT" }], [1, 2, 3, 4])).toEqual([4]);
	});

	it("複数命令を上から順に適用する", () => {
		expect(
			run(
				[
					{ type: "FILTER_GT", value: 2 },
					{ type: "MAP_MULTIPLY", value: 2 },
					{ type: "SORT_ASC" },
				],
				[1, 2, 4, 3],
			),
		).toEqual([6, 8]);
	});

	it("入力配列を書き換えない", () => {
		const input = [3, 1, 2];
		run([{ type: "SORT_ASC" }], input);
		expect(input).toEqual([3, 1, 2]);
	});
});

describe("dslProgramSchema - 境界での検証", () => {
	it("未知の命令を拒否する", () => {
		expect(
			dslProgramSchema.safeParse({ commands: [{ type: "RM_RF" }] }).success,
		).toBe(false);
	});

	it("数値にならない値を拒否する", () => {
		expect(
			dslProgramSchema.safeParse({
				commands: [{ type: "FILTER_GT", value: "abc" }],
			}).success,
		).toBe(false);
	});

	it("commands を持たない値を拒否する", () => {
		expect(dslProgramSchema.safeParse(null).success).toBe(false);
		expect(dslProgramSchema.safeParse({}).success).toBe(false);
	});
});
