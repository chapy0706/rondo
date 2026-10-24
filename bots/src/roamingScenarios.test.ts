/**
 * 動ける隠れ側の規則のシナリオ（ADR 0053）の宣言の整合と、手順が 10 種の骨格で動くか（サーバーなしで見る）。
 * 既存のシナリオ（scenarios.test.ts・wideScenarios.test.ts）は変えず、別の配列（roamingScenarios）を確かめる。
 */
import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import skeletons from "../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { checkNoRoaming } from "./expect.ts";
import { cellOf, findPath, pickDoorShot } from "./plan.ts";
import {
	allScenarios,
	expiryScenarios,
	roamingScenarios,
	spreadingScenarios,
} from "./scenarios.ts";
import { readStageNotice } from "./stage.ts";
import { SERVER_DEFAULTS, scaled } from "./timing.ts";

describe("roamingScenarios - 宣言の整合", () => {
	it("動ける隠れ側の規則（roaming: 1）だけで、CPU を加えない。ほかのシナリオは規則を選ばない", () => {
		expect(roamingScenarios.map((s) => s.name)).toEqual([
			"動ける隠れ側の移動・襖・見た目・射撃",
		]);
		for (const scenario of roamingScenarios) {
			expect(scenario.settings).toEqual({ roaming: 1 });
		}
		for (const scenario of [
			...allScenarios,
			...expiryScenarios,
			...spreadingScenarios,
		]) {
			expect(scenario.settings?.roaming).toBeUndefined();
		}
	});

	it.each(roamingScenarios.map((s) => [s.name, s] as const))(
		"%s: 手順・受け手・結果の行が、参加するボットだけを指す",
		(_name, scenario) => {
			const bots = new Set(scenario.bots);
			expect(bots.size).toBe(scenario.bots.length);
			for (const step of scenario.steps) expect(bots).toContain(step.bot);
			for (const bot of scenario.receivers) expect(bots).toContain(bot);
			for (const row of scenario.rankings) expect(bots).toContain(row.bot);
		},
	);

	it.each(roamingScenarios.map((s) => [s.name, s] as const))(
		"%s: 確かめは名前があり、縮めた探索（2 秒）が終わる前に終える。撃つのは 1 回",
		(_name, scenario) => {
			const exploration = scaled(SERVER_DEFAULTS.explorationMs);
			expect(exploration).toBe(2000);
			const during = scenario.steps.filter(
				(step) =>
					typeof step.on === "object" && step.on.phase === "exploration",
			);
			for (const step of during) {
				expect(step.delayMs ?? 0).toBeLessThanOrEqual(exploration - 500);
				if ("check" in step.action) {
					expect(step.action.check.length).toBeGreaterThan(0);
				}
			}
			expect(
				scenario.steps.filter((step) => step.action.type === "shoot"),
			).toHaveLength(1);
		},
	);
});

describe("10 種の骨格の見本で、動ける隠れ側の手順が歩ける", () => {
	const stages = skeletons.stages.map((notice, i) => {
		const stage = readStageNotice(notice);
		if (stage === null) throw new Error(`骨格 ${i + 1} が読めない`);
		return [i + 1, stage] as const;
	});

	it.each(stages)(
		"骨格 %i: 隠れ側は r → c → r → s、鬼は玄関から c へ歩ける",
		(_n, stage) => {
			const plan = pickDoorShot(stage);
			expect(plan).not.toBeNull();
			if (plan === null) return;
			const spawn = cellOf(stage, stage.spawn);
			expect(findPath(stage, spawn, plan.r, "open")).not.toBeNull();
			expect(findPath(stage, plan.r, plan.c, "open")).not.toBeNull();
			expect(findPath(stage, plan.c, plan.r, "open")).not.toBeNull();
			expect(findPath(stage, plan.r, plan.s, "open")).not.toBeNull();
			expect(findPath(stage, spawn, plan.c, "closed")).not.toBeNull();
		},
	);
});

describe("checkNoRoaming - 従来の規則のルームに、動ける隠れ側の通知が届かない", () => {
	const state = (payload: unknown): ServerMessage =>
		({
			type: "game-state",
			gameType: "veryare",
			roomId: "r",
			payload,
		}) as ServerMessage;

	it("roaming・look が届いていれば、問題にする。ほかの通知は数えない", () => {
		expect(
			checkNoRoaming("bot-a", [
				state({ type: "phase" }),
				state({ type: "hiders" }),
			]),
		).toEqual([]);
		expect(
			checkNoRoaming("bot-a", [
				state({ type: "roaming", hiders: [] }),
				state({ type: "look", playerId: "p" }),
			]),
		).toEqual([
			"bot-a に、従来の規則のルームで、動ける隠れ側の通知が 2 通届いた",
		]);
	});
});

describe("spreadingScenarios - 増え鬼の宣言の整合（ADR 0053）", () => {
	it("全員が鬼になる・時間切れで逃げ切る、の 2 つ。どれも増え鬼だけで、ほかのシナリオは選ばない", () => {
		expect(spreadingScenarios.map((s) => s.name)).toEqual([
			"増え鬼で全員が鬼になり鬼の勝ち",
			"増え鬼の時間切れで逃げ切り",
		]);
		for (const scenario of spreadingScenarios) {
			expect(scenario.settings).toEqual({ spreading: 1 });
		}
		for (const scenario of [
			...allScenarios,
			...expiryScenarios,
			...roamingScenarios,
		]) {
			expect(scenario.settings?.spreading).toBeUndefined();
		}
	});

	it.each(spreadingScenarios.map((s) => [s.name, s] as const))(
		"%s: 手順・受け手・結果の行が、参加するボットだけを指し、撃つ間隔は鬼ごとに空ける",
		(_name, scenario) => {
			const bots = new Set(scenario.bots);
			for (const step of scenario.steps) expect(bots).toContain(step.bot);
			for (const row of scenario.rankings) expect(bots).toContain(row.bot);
			const reload = scaled(SERVER_DEFAULTS.reloadMs);
			const shots = new Map<string, number[]>();
			for (const step of scenario.steps) {
				if (step.action.type !== "shoot") continue;
				shots.set(step.bot, [
					...(shots.get(step.bot) ?? []),
					step.delayMs ?? 0,
				]);
			}
			for (const times of shots.values()) {
				for (let i = 1; i < times.length; i++) {
					expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(
						reload,
					);
				}
			}
		},
	);
});
