import type { DslProgram, DslTestCase } from "./schema";

/** お題。czz の tasks テーブルのうち、演習に必要な列だけを持つ。 */
export type CzzTask = {
	id: string;
	title: string;
	description: string;
	/** 模範解答（czz の tasks.dsl_program） */
	referenceProgram: DslProgram;
	testCases: DslTestCase[];
};
