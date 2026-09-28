// czz の packages/dsl-core/src/execute.ts から取り込んだ実行エンジン。
// rondo の strict 設定（noUncheckedIndexedAccess / noUnusedLocals）に合わせ、
// OUTPUT_FIRST / OUTPUT_LAST と網羅性チェックの書き方だけを変えている（挙動は同じ）。
import type { DslCommand, DslProgram } from "./schema";

export type DslInput = number[];
export type DslOutput = number[];

/** 命令を上から順に適用する。入力は書き換えず、常に新しい配列を返す。 */
export function execute(program: DslProgram, input: DslInput): DslOutput {
	let current: DslOutput = [...input];

	for (const command of program.commands) {
		current = applyCommand(command, current);
	}

	return current;
}

function applyCommand(command: DslCommand, input: DslInput): DslOutput {
	switch (command.type) {
		case "FILTER_EQUALS":
			return input.filter((v) => v === command.value);

		case "FILTER_NOT_EQUALS":
			return input.filter((v) => v !== command.value);

		case "FILTER_GT":
			return input.filter((v) => v > command.value);

		case "FILTER_LT":
			return input.filter((v) => v < command.value);

		case "FILTER_BETWEEN":
			return input.filter((v) => v >= command.min && v <= command.max);

		case "MAP_ADD":
			return input.map((v) => v + command.value);

		case "MAP_MULTIPLY":
			return input.map((v) => v * command.value);

		case "SORT_ASC":
			return [...input].sort((a, b) => a - b);

		case "SORT_DESC":
			return [...input].sort((a, b) => b - a);

		// OUTPUT 系も配列で返す（空入力なら空配列）
		case "OUTPUT_FIRST":
			return input.slice(0, 1);

		case "OUTPUT_LAST":
			return input.slice(-1);

		case "OUTPUT_SUM":
			return [input.reduce((acc, v) => acc + v, 0)];

		case "OUTPUT_COUNT":
			return [input.length];

		default: {
			const exhaustive: never = command;
			return exhaustive;
		}
	}
}
