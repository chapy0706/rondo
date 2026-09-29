import { describe, expect, it } from "vitest";
import { czzTasks } from "./data/tasks";
import {
	MAX_COMMANDS,
	type SessionAction,
	type SessionState,
	eligibleTasks,
	pickTasks,
	sessionReducer,
	sessionResult,
	startSession,
} from "./session";

describe("eligibleTasks - 出題対象の絞り込み", () => {
	it("模範解答の命令数が2以下のお題だけを残す", () => {
		const eligible = eligibleTasks(czzTasks);

		expect(eligible.length).toBeGreaterThan(0);
		for (const task of eligible) {
			expect(task.referenceProgram.commands.length).toBeLessThanOrEqual(
				MAX_COMMANDS,
			);
		}
	});

	it("命令が3段のお題（T16〜T20）は出題しない", () => {
		const titles = eligibleTasks(czzTasks).map((task) => task.title);

		expect(titles).toHaveLength(15);
		for (const n of [16, 17, 18, 19, 20]) {
			expect(titles.some((title) => title.startsWith(`T${n}:`))).toBe(false);
		}
	});
});

describe("pickTasks - 1セッション分の出題", () => {
	const eligible = eligibleTasks(czzTasks);

	it("重複なしで指定数を選ぶ", () => {
		const picked = pickTasks(eligible, 3, Math.random);

		expect(picked).toHaveLength(3);
		expect(new Set(picked.map((task) => task.id)).size).toBe(3);
		for (const task of picked) expect(eligible).toContain(task);
	});

	it("同じ乱数列なら同じお題を選ぶ", () => {
		const sequence = () => {
			let seed = 0.37;
			return () => {
				seed = (seed * 9301 + 0.49297) % 1;
				return seed;
			};
		};

		expect(pickTasks(eligible, 3, sequence())).toEqual(
			pickTasks(eligible, 3, sequence()),
		);
	});

	it("乱数が端の値でも範囲外を選ばない", () => {
		expect(pickTasks(eligible, 3, () => 0)).toHaveLength(3);
		expect(pickTasks(eligible, 3, () => 0.999999)).toHaveLength(3);
	});

	it("お題が足りなければあるだけ返す", () => {
		expect(pickTasks(eligible.slice(0, 2), 3, Math.random)).toHaveLength(2);
	});

	it("元の配列を並べ替えない", () => {
		const before = [...eligible];
		pickTasks(eligible, 3, Math.random);
		expect(eligible).toEqual(before);
	});
});

describe("sessionReducer - 3問の進行と正解数", () => {
	const three = czzTasks.slice(0, 3);
	const play = (...actions: SessionAction[]): SessionState =>
		actions.reduce(sessionReducer, startSession(three));

	it("1問目から始まり、正解数は 0", () => {
		const state = startSession(three);
		expect(state.index).toBe(0);
		expect(state.finished).toBe(false);
		expect(sessionResult(state).score).toBe(0);
	});

	it("採点する前は次へ進めない", () => {
		expect(play({ type: "next" }).index).toBe(0);
	});

	it("不正解でも採点した後なら次へ進める", () => {
		const state = play({ type: "graded", allPassed: false }, { type: "next" });
		expect(state.index).toBe(1);
		expect(sessionResult(state).score).toBe(0);
	});

	it("不正解のあと組み直して正解すれば、正解として数える", () => {
		const state = play(
			{ type: "graded", allPassed: false },
			{ type: "graded", allPassed: true },
		);
		expect(sessionResult(state).score).toBe(1);
	});

	it("一度正解した問題は、その後の不正解で取り消さない", () => {
		const state = play(
			{ type: "graded", allPassed: true },
			{ type: "graded", allPassed: false },
		);
		expect(sessionResult(state).score).toBe(1);
	});

	it("同じ問題を何度正解しても 1 問として数える", () => {
		const state = play(
			{ type: "graded", allPassed: true },
			{ type: "graded", allPassed: true },
		);
		expect(sessionResult(state).score).toBe(1);
	});

	it("最後の問題で次へ進むと終了し、正解数と出題数を返す", () => {
		const state = play(
			{ type: "graded", allPassed: true },
			{ type: "next" },
			{ type: "graded", allPassed: false },
			{ type: "next" },
			{ type: "graded", allPassed: true },
			{ type: "next" },
		);
		expect(state.finished).toBe(true);
		expect(sessionResult(state)).toEqual({ score: 2, details: { total: 3 } });
	});

	it("終了後の操作は無視する", () => {
		const finished = play(
			{ type: "graded", allPassed: false },
			{ type: "next" },
			{ type: "graded", allPassed: false },
			{ type: "next" },
			{ type: "graded", allPassed: false },
			{ type: "next" },
		);
		expect(sessionReducer(finished, { type: "graded", allPassed: true })).toBe(
			finished,
		);
		expect(sessionReducer(finished, { type: "next" })).toBe(finished);
	});
});
