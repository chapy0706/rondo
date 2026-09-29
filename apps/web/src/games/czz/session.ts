// 1セッションの出題と進行。並べ替えができない最小構成なので、命令が3段のお題は出さない。
import type { PlayResult } from "@rondo/contracts";
import type { CzzTask } from "./core/task";

/** 出題対象とする模範解答の命令数の上限。 */
export const MAX_COMMANDS = 2;

/** 1セッションの出題数（2〜3分に収める）。 */
export const TASKS_PER_SESSION = 3;

export function eligibleTasks(tasks: readonly CzzTask[]): CzzTask[] {
	return tasks.filter(
		(task) => task.referenceProgram.commands.length <= MAX_COMMANDS,
	);
}

/** 重複なしで count 問を選ぶ。random は [0, 1) を返す関数（テストでは固定値を渡す）。 */
export function pickTasks(
	tasks: readonly CzzTask[],
	count: number,
	random: () => number,
): CzzTask[] {
	const pool = [...tasks];
	// Fisher-Yates を先頭 count 個だけ回す
	const n = Math.min(count, pool.length);
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(random() * (pool.length - i));
		const picked = pool[j];
		const current = pool[i];
		if (picked === undefined || current === undefined) continue;
		pool[i] = picked;
		pool[j] = current;
	}
	return pool.slice(0, n);
}

export type SessionState = {
	tasks: readonly CzzTask[];
	index: number;
	/** 問題ごとに、一度でも正解したか。 */
	solved: readonly boolean[];
	/** 今の問題を一度でも採点したか。採点するまでは次へ進めない。 */
	graded: boolean;
	finished: boolean;
};

export type SessionAction =
	| { type: "graded"; allPassed: boolean }
	| { type: "next" };

export function startSession(tasks: readonly CzzTask[]): SessionState {
	return {
		tasks,
		index: 0,
		solved: tasks.map(() => false),
		graded: false,
		finished: tasks.length === 0,
	};
}

export function sessionReducer(
	state: SessionState,
	action: SessionAction,
): SessionState {
	if (state.finished) return state;

	switch (action.type) {
		case "graded":
			return {
				...state,
				graded: true,
				solved: state.solved.map((solved, i) =>
					i === state.index ? solved || action.allPassed : solved,
				),
			};

		case "next":
			if (!state.graded) return state;
			if (state.index >= state.tasks.length - 1) {
				return { ...state, finished: true };
			}
			return { ...state, index: state.index + 1, graded: false };

		default: {
			const exhaustive: never = action;
			return exhaustive;
		}
	}
}

/** 基盤へ返す結果。スコアは正解した問題数。 */
export function sessionResult(state: SessionState): PlayResult {
	return {
		score: state.solved.filter(Boolean).length,
		details: { total: state.tasks.length },
	};
}
