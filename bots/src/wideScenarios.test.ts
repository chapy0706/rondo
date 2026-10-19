/**
 * 広い屋敷のシナリオ（issue-65）の宣言の整合と、手順が広い屋敷の地図で動くか（サーバーなしで見る）。
 * 既存のシナリオ（scenarios.test.ts）は変えず、広い屋敷のシナリオ（wideScenarios）を、同じ規則で確かめる。
 */
import { describe, expect, it } from "vitest";
import skeletons from "../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { cellOf, findPath, pickDoorShot } from "./plan.ts";
import { HIDE_MAX_DISTANCE, WIDE_MIN_WIDTH } from "./runner.ts";
import { allScenarios, scenarios, wideScenarios } from "./scenarios.ts";
import { MIN_GAP, readStageNotice, spreadSpots } from "./stage.ts";
import { SERVER_DEFAULTS, scaled } from "./timing.ts";

/** 広い屋敷の探索（ルームの既定 40 秒 + 80 秒）を、縮めた長さ。 */
const wideExploration = scaled(SERVER_DEFAULTS.explorationMs + 80_000);

describe("wideScenarios - 宣言の整合", () => {
	it("時間切れ・全員発見・壁越しと襖越しの射撃の 3 つ。どれも広い屋敷だけ（stage 3）で、CPU を加えない", () => {
		expect(wideScenarios.map((s) => s.name)).toEqual([
			"広い屋敷で時間切れ",
			"広い屋敷で全員発見",
			"広い屋敷の壁越し・襖越しの射撃",
		]);
		for (const scenario of wideScenarios) {
			expect(scenario.settings).toEqual({ stage: 3 });
		}
	});

	it("make bots は、既存のシナリオの後に、広い屋敷のシナリオを流す", () => {
		expect(allScenarios).toEqual([...scenarios, ...wideScenarios]);
		// 既存のシナリオは、広い屋敷を選ばない（サーバーの既定のまま）。
		for (const scenario of scenarios) {
			expect(scenario.settings?.stage ?? 0).not.toBe(3);
		}
	});

	it.each(wideScenarios.map((s) => [s.name, s] as const))(
		"%s: 手順・受け手・結果の行が、参加するボットだけを指し、定員を超えない",
		(_name, scenario) => {
			const bots = new Set(scenario.bots);
			expect(bots.size).toBe(scenario.bots.length);
			expect(scenario.bots.length).toBeLessThanOrEqual(5);
			for (const step of scenario.steps) expect(bots).toContain(step.bot);
			for (const bot of scenario.receivers) expect(bots).toContain(bot);
			for (const row of scenario.rankings) expect(bots).toContain(row.bot);
			const ranks = scenario.rankings.map((row) => row.rank);
			expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
		},
	);

	it.each(wideScenarios.map((s) => [s.name, s] as const))(
		"%s: 準備移動の始まりに、広い屋敷と +80 秒の探索時間を確かめる",
		(_name, scenario) => {
			const checks = scenario.steps.filter(
				(step) => step.action.type === "expect-wide",
			);
			expect(checks).toHaveLength(1);
			const check = checks[0];
			expect(check?.on).toEqual({ phase: "preparation" });
			expect(
				check?.action.type === "expect-wide"
					? check.action.explorationSeconds
					: null,
			).toBe(120);
		},
	);

	it.each(
		wideScenarios
			.filter((s) => s.steps.some((step) => step.action.type === "shoot"))
			.map((s) => [s.name, s] as const),
	)(
		"%s: 撃つ間隔を空け、縮めた探索（6 秒）が終わる前に撃ち終える",
		(_name, scenario) => {
			const reload = scaled(SERVER_DEFAULTS.reloadMs);
			const shots = scenario.steps
				.filter((step) => step.action.type === "shoot")
				.map((step) => step.delayMs ?? 0)
				.sort((a, b) => a - b);
			for (let i = 1; i < shots.length; i++) {
				expect((shots[i] ?? 0) - (shots[i - 1] ?? 0)).toBeGreaterThanOrEqual(
					reload + 100,
				);
			}
			expect(wideExploration).toBe(6000);
			expect(shots.at(-1) ?? 0).toBeLessThanOrEqual(wideExploration - 500);
		},
	);
});

describe("広い屋敷の見本（wideStages）で、ボットの手順が動く", () => {
	const stages = skeletons.wideStages.map((notice, i) => {
		const stage = readStageNotice(notice);
		if (stage === null) throw new Error(`広い屋敷 ${i + 1} が読めない`);
		return [i + 1, stage] as const;
	});

	it.each(stages)("広い屋敷 %i: 幅は 20 m 以上", (_n, stage) => {
		expect(stage.width).toBeGreaterThanOrEqual(WIDE_MIN_WIDTH);
	});

	it.each(stages)(
		"広い屋敷 %i: 玄関から一直線に、隠れ側 4 人の別々の場所を選べる（射程の内側）",
		(_n, stage) => {
			const spots = spreadSpots(stage, 4, HIDE_MAX_DISTANCE);
			expect(spots).toHaveLength(4);
			const points = [stage.spawn, ...spots];
			for (let i = 0; i < points.length; i++) {
				for (let j = i + 1; j < points.length; j++) {
					const a = points[i] as { x: number; z: number };
					const b = points[j] as { x: number; z: number };
					expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
						MIN_GAP,
					);
				}
			}
			for (const p of spots) {
				expect(
					Math.hypot(p.x - stage.spawn.x, p.z - stage.spawn.z),
				).toBeLessThanOrEqual(HIDE_MAX_DISTANCE);
			}
		},
	);

	it.each(stages)(
		"広い屋敷 %i: 壁越し・襖越しの射撃のマスを選べ、玄関から歩いて着ける",
		(_n, stage) => {
			const plan = pickDoorShot(stage);
			expect(plan).not.toBeNull();
			if (plan === null) return;
			const spawn = cellOf(stage, stage.spawn);
			expect(findPath(stage, spawn, plan.w, "closed")).not.toBeNull();
			expect(findPath(stage, plan.w, plan.c, "closed")).not.toBeNull();
			expect(findPath(stage, spawn, plan.r, "open")).not.toBeNull();
			expect(findPath(stage, spawn, plan.s, "open")).not.toBeNull();
		},
	);
});
