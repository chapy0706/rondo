// czz の packages/dsl-core/src/schema.ts から取り込んだ DSL の仕様。
// 入力は数値配列、命令は上から順に適用する。提出物・お題データはこのスキーマで検証してから扱う。
import { z } from "zod";

export const filterEqualsCommandSchema = z.object({
	type: z.literal("FILTER_EQUALS"),
	value: z.coerce.number(),
});

export const filterNotEqualsCommandSchema = z.object({
	type: z.literal("FILTER_NOT_EQUALS"),
	value: z.coerce.number(),
});

export const filterGtCommandSchema = z.object({
	type: z.literal("FILTER_GT"),
	value: z.coerce.number(),
});

export const filterLtCommandSchema = z.object({
	type: z.literal("FILTER_LT"),
	value: z.coerce.number(),
});

export const filterBetweenCommandSchema = z.object({
	type: z.literal("FILTER_BETWEEN"),
	min: z.coerce.number(),
	max: z.coerce.number(),
});

export const mapAddCommandSchema = z.object({
	type: z.literal("MAP_ADD"),
	value: z.number(),
});

export const mapMultiplyCommandSchema = z.object({
	type: z.literal("MAP_MULTIPLY"),
	value: z.number(),
});

export const sortAscCommandSchema = z.object({
	type: z.literal("SORT_ASC"),
});

export const sortDescCommandSchema = z.object({
	type: z.literal("SORT_DESC"),
});

export const outputFirstCommandSchema = z.object({
	type: z.literal("OUTPUT_FIRST"),
});

export const outputLastCommandSchema = z.object({
	type: z.literal("OUTPUT_LAST"),
});

export const outputSumCommandSchema = z.object({
	type: z.literal("OUTPUT_SUM"),
});

export const outputCountCommandSchema = z.object({
	type: z.literal("OUTPUT_COUNT"),
});

export const dslCommandSchema = z.discriminatedUnion("type", [
	filterEqualsCommandSchema,
	filterNotEqualsCommandSchema,
	filterGtCommandSchema,
	filterLtCommandSchema,
	filterBetweenCommandSchema,
	mapAddCommandSchema,
	mapMultiplyCommandSchema,
	sortAscCommandSchema,
	sortDescCommandSchema,
	outputFirstCommandSchema,
	outputLastCommandSchema,
	outputSumCommandSchema,
	outputCountCommandSchema,
]);

export const dslProgramSchema = z.object({
	commands: z.array(dslCommandSchema),
});

export const dslTestCaseSchema = z.object({
	input: z.array(z.number()),
	expected: z.array(z.number()),
});

export type DslCommand = z.infer<typeof dslCommandSchema>;
export type DslProgram = z.infer<typeof dslProgramSchema>;
export type DslTestCase = z.infer<typeof dslTestCaseSchema>;
