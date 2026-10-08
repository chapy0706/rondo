import { describe, expect, it } from "vitest";
import { scenarios } from "./scenarios.ts";

describe("scenarios - 宣言の整合（書き間違いを、サーバーなしで見つける）", () => {
	it("issue-49 の4つがそろっている（全員発見は issue-27 で足す）", () => {
		expect(scenarios.map((s) => s.name)).toEqual([
			"時間切れで隠れ側の勝ち",
			"鬼の離脱で隠れ側の勝ち",
			"人数が足りず不成立",
			"被りによる全員失格で鬼の勝ち",
		]);
	});

	it.each(scenarios.map((s) => [s.name, s] as const))(
		"%s: 手順・受け手・結果の行が、参加するボットだけを指している",
		(_name, scenario) => {
			const bots = new Set(scenario.bots);
			expect(bots.size).toBe(scenario.bots.length);
			for (const step of scenario.steps) expect(bots).toContain(step.bot);
			for (const bot of scenario.receivers) expect(bots).toContain(bot);
			for (const row of scenario.rankings) expect(bots).toContain(row.bot);
			// 結果の行は、1位から順に並べて書く。
			const ranks = scenario.rankings.map((row) => row.rank);
			expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
		},
	);

	it("限定配信（ADR 0021）を、少なくとも1つのシナリオで確かめる", () => {
		expect(scenarios.some((s) => s.targeted === true)).toBe(true);
	});

	it("定員（5人）を超えない", () => {
		for (const scenario of scenarios) {
			expect(scenario.bots.length).toBeLessThanOrEqual(5);
		}
	});
});
