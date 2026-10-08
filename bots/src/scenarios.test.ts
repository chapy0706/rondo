import { describe, expect, it } from "vitest";
import { scenarios } from "./scenarios.ts";
import { BOTS_PHASE_DIVISOR, SERVER_DEFAULTS, scaled } from "./timing.ts";

describe("scenarios - 宣言の整合（書き間違いを、サーバーなしで見つける）", () => {
	it("issue-49 の4つと、issue-27 の全員発見がそろっている", () => {
		expect(scenarios.map((s) => s.name)).toEqual([
			"時間切れで隠れ側の勝ち",
			"鬼の離脱で隠れ側の勝ち",
			"人数が足りず不成立",
			"被りによる全員失格で鬼の勝ち",
			"全員発見で鬼の勝ち",
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

describe("scenarios - 撃つ手順が、縮めた探索時間の中に収まる（issue-27）", () => {
	const exploration = scaled(SERVER_DEFAULTS.explorationMs);
	const reload = scaled(SERVER_DEFAULTS.reloadMs);
	/** 通信の揺らぎを見込んだ余裕（ミリ秒）。 */
	const margin = 100;

	it("縮め方は、サーバーと同じ（割って切り捨て、1 より小さくしない）", () => {
		expect(BOTS_PHASE_DIVISOR).toBe(20);
		expect(exploration).toBe(2000);
		expect(reload).toBe(150);
		expect(scaled(3, 1000)).toBe(1);
	});

	it.each(
		scenarios
			.filter((s) => s.steps.some((step) => step.action.type === "shoot"))
			.map((s) => [s.name, s] as const),
	)("%s: 撃つ間隔を空け、探索が終わる前に撃ち終える", (_name, scenario) => {
		const shots = scenario.steps
			.filter((step) => step.action.type === "shoot")
			.map((step) => {
				expect(step.on).toEqual({ phase: "exploration" });
				return step.delayMs ?? 0;
			})
			.sort((a, b) => a - b);
		expect(shots.length).toBeGreaterThan(0);
		for (let i = 1; i < shots.length; i++) {
			const gap = (shots[i] ?? 0) - (shots[i - 1] ?? 0);
			expect(gap).toBeGreaterThanOrEqual(reload + margin);
		}
		expect(shots.at(-1) ?? 0).toBeLessThanOrEqual(exploration - 5 * margin);
	});
});
