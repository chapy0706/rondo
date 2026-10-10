import { describe, expect, it } from "vitest";
import { scenarios } from "./scenarios.ts";
import { BOTS_PHASE_DIVISOR, SERVER_DEFAULTS, scaled } from "./timing.ts";

describe("scenarios - 宣言の整合（書き間違いを、サーバーなしで見つける）", () => {
	it("issue-49 の4つと、issue-27 の全員発見、issue-29b の壁越し・襖越し、issue-25 のペイントがそろっている", () => {
		expect(scenarios.map((s) => s.name)).toEqual([
			"時間切れで隠れ側の勝ち",
			"鬼の離脱で隠れ側の勝ち",
			"人数が足りず不成立",
			"被りによる全員失格で鬼の勝ち",
			"全員発見で鬼の勝ち",
			"壁越し・襖越しの射撃",
			"ペイントの確定と一括配信",
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

describe("scenarios - 玄関からの散らばり方（issue-29a）", () => {
	it.each(scenarios.map((s) => [s.name, s] as const))(
		"%s: 隠れ場所の番号は、隠れ側ごとに違い、準備移動の始まりに動く",
		(_name, scenario) => {
			const hides = scenario.steps.filter(
				(step) => step.action.type === "hide",
			);
			const indices = hides.map((step) =>
				step.action.type === "hide" ? step.action.index : -1,
			);
			expect(new Set(indices).size).toBe(indices.length);
			expect(new Set(hides.map((step) => step.bot)).size).toBe(hides.length);
			for (const step of hides) {
				expect(step.on).toEqual({ phase: "preparation" });
				expect(step.bot).not.toBe(scenario.bots[0]);
			}
		},
	);

	it("時間切れ・全員発見では隠れ側全員が散らばり、被りのシナリオでは誰も動かない", () => {
		const hidden = (name: string) =>
			scenarios
				.find((s) => s.name === name)
				?.steps.filter((step) => step.action.type === "hide")
				.map((step) => step.bot);
		expect(hidden("時間切れで隠れ側の勝ち")).toEqual([
			"bot-b",
			"bot-c",
			"bot-d",
			"bot-e",
		]);
		expect(hidden("全員発見で鬼の勝ち")).toEqual(["bot-b", "bot-c"]);
		const overlap = scenarios.find(
			(s) => s.name === "被りによる全員失格で鬼の勝ち",
		);
		expect(
			overlap?.steps.some(
				(step) => step.action.type === "hide" || step.action.type === "move",
			),
		).toBe(false);
	});
});

describe("scenarios - 壁越し・襖越しの射撃の時間（issue-29b）", () => {
	const scenario = scenarios.find((s) => s.name === "壁越し・襖越しの射撃");
	if (scenario === undefined) throw new Error("シナリオが無い");
	const exploration = scaled(SERVER_DEFAULTS.explorationMs);
	const reload = scaled(SERVER_DEFAULTS.reloadMs);
	const at = (type: string) =>
		scenario.steps
			.filter((step) => step.action.type === type)
			.map((step) => step.delayMs ?? 0);

	it("確かめは3つで、それぞれ名前がある", () => {
		expect(
			scenario.steps.flatMap((step) =>
				step.action.type === "expect-hiding" ? [step.action.check] : [],
			),
		).toEqual([
			"壁越しの射撃は外れる",
			"閉じた襖越しの射撃は外れる",
			"開けた襖越しの射撃は当たる",
		]);
	});

	it("各確かめは、直前の射撃から、縮めた撃つ間隔（150 ms）の内側で、届くのを待つ余裕（50 ms 以上）を取る", () => {
		const shots = at("shoot");
		const checks = at("expect-hiding");
		expect(checks).toHaveLength(shots.length);
		checks.forEach((check, i) => {
			const wait = check - (shots[i] ?? 0);
			expect(wait).toBeGreaterThanOrEqual(50);
			expect(wait).toBeLessThan(reload);
		});
	});

	it("歩くのと襖を開けるのは、次の射撃より前。最後の確かめは、縮めた探索（2 秒）が終わる前", () => {
		const steps = scenario.steps.filter((step) => step.on !== "joined");
		const order = steps
			.filter(
				(step) =>
					typeof step.on === "object" && step.on.phase === "exploration",
			)
			.map((step) => [step.action.type, step.delayMs ?? 0] as const);
		for (let i = 1; i < order.length; i++) {
			expect((order[i] as readonly [string, number])[1]).toBeGreaterThan(
				(order[i - 1] as readonly [string, number])[1],
			);
		}
		expect(Math.max(...at("expect-hiding"))).toBeLessThanOrEqual(
			exploration - 500,
		);
	});
});
