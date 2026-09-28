// czz の EvaluateTaskUseCase から、DB 取得・結果保存・ユーザー解決を除いた採点の核。
import { dslProgramSchema } from "./schema";
import type { CzzTask } from "./task";
import { type TestCasesResult, runTestCases } from "./testRunner";

export type GradeResult =
	| { valid: false }
	| ({ valid: true } & TestCasesResult);

/** 提出物（未検証）をお題のテストケースで採点する。スキーマに合わなければ採点しない。 */
export function grade(submitted: unknown, task: CzzTask): GradeResult {
	const parsed = dslProgramSchema.safeParse(submitted);
	if (!parsed.success) return { valid: false };

	return { valid: true, ...runTestCases(parsed.data, task.testCases) };
}
