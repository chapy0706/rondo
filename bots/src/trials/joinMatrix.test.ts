import { describe, expect, it } from "vitest";
import {
	CPU_SETTING,
	type JoinCase,
	expectedKinds,
	joinCases,
	judgeArrival,
	latestPhase,
	membersListed,
} from "./joinMatrix.ts";

const phase = (
	name: string,
	area: string | null = null,
	oni: string | null = null,
) => ({
	type: "phase",
	phase: name,
	durationMs: null,
	area,
	oni,
	outcome: null,
});
const of = (type: string) => ({ type });

describe("joinCases - 実際に起こりうる組み合わせだけを並べる", () => {
	const cases = joinCases();
	const find = (cpu: string, order: string, moment: string) =>
		cases.find(
			(c) => c.cpu === cpu && c.order === order && c.moment === moment,
		);

	it("CPU の数（0・1・2）と鬼 CPU、参加の順番、時機の軸を持ち、名前は重ならない", () => {
		expect(new Set(cases.map((c) => c.cpu))).toEqual(
			new Set(["none", "hider-1", "hider-2", "oni"]),
		);
		expect(new Set(cases.map((c) => c.order))).toEqual(
			new Set(["creator", "second", "third"]),
		);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
		expect(CPU_SETTING).toEqual({
			none: 0,
			"hider-1": 1,
			"hider-2": 2,
			oni: 4,
		});
	});

	it("CPU なしの 2 人目は、赤（1 人）のときに入る。CPU ありは、最初から緑", () => {
		expect(find("none", "second", "waiting")?.areaBefore).toBe("waiting");
		expect(find("hider-1", "second", "waiting")?.areaBefore).toBe("ready");
		expect(find("oni", "second", "waiting")?.areaBefore).toBe("ready");
		expect(find("none", "third", "waiting")?.areaBefore).toBe("ready");
	});

	it("カウントは 2 人以上でしか始まらないので、CPU なしの 2 人目のカウント中は無い", () => {
		expect(find("none", "second", "counting")).toBeUndefined();
		expect(find("hider-1", "second", "counting")?.outcome).toBe("same-state");
		expect(find("none", "third", "counting")?.outcome).toBe("same-state");
	});

	it("鬼選出の後（準備移動・ペイント・探索・答え合わせ）の参加は、サーバーが断る", () => {
		for (const moment of ["preparation", "painting", "exploration", "reveal"]) {
			const refused = cases.filter((c) => c.moment === moment);
			expect(refused.length, moment).toBeGreaterThan(0);
			for (const c of refused) expect(c.outcome, c.name).toBe("refused");
		}
		// 人間 1 人と CPU なしでは始まらないので、CPU なしの 2 人目の、鬼選出の後は無い。
		expect(find("none", "second", "preparation")).toBeUndefined();
	});

	it("作った人は、作成のとき（待機）だけ。定員 5 人を超える組み合わせは無い", () => {
		const creators = cases.filter((c) => c.order === "creator");
		expect(creators.map((c) => c.moment)).toEqual([
			"waiting",
			"waiting",
			"waiting",
			"waiting",
		]);
		const humans = (c: JoinCase) =>
			c.order === "third" ? 3 : c.order === "second" ? 2 : 1;
		for (const c of cases) {
			const cpus = c.cpu === "none" ? 0 : c.cpu === "hider-2" ? 2 : 1;
			expect(humans(c) + cpus, c.name).toBeLessThanOrEqual(5);
		}
	});
});

describe("expectedKinds - その時機に、購読者へ届くべき状態の種類", () => {
	it("鬼選出: ステージ・襖・フェーズ・メンバー・ルーム情報", () => {
		expect(expectedKinds("oni-selection")).toEqual([
			"doors",
			"members",
			"phase",
			"room-info",
			"stage",
		]);
	});

	it("準備移動・ペイント: メンバーなし。探索・答え合わせ: 隠れ側の一括配信・まだ隠れている人・鬼", () => {
		expect(expectedKinds("preparation")).toEqual([
			"doors",
			"phase",
			"room-info",
			"stage",
		]);
		expect(expectedKinds("painting")).toEqual([
			"doors",
			"phase",
			"room-info",
			"stage",
		]);
		expect(expectedKinds("exploration")).toEqual([
			"doors",
			"hiders",
			"hiding",
			"oni",
			"phase",
			"room-info",
			"stage",
		]);
		expect(expectedKinds("reveal")).toEqual(expectedKinds("exploration"));
	});
});

describe("latestPhase・judgeArrival - 届いた通知を、最初の参加者のものと比べる", () => {
	const full = [
		of("stage"),
		of("doors"),
		phase("oni-selection", "ready"),
		of("members"),
		of("room-info"),
	];

	it("最後に届いたフェーズの通知の、フェーズ・エリア・鬼", () => {
		expect(
			latestPhase([
				phase("oni-selection", "ready"),
				phase("oni-selection", "counting"),
			]),
		).toEqual({
			phase: "oni-selection",
			area: "counting",
			oni: null,
		});
		expect(latestPhase([of("stage")])).toBeNull();
	});

	it("同じ種類がそろい、フェーズの中身が最初の参加者と同じなら、問題なし", () => {
		expect(
			judgeArrival({
				arrived: full,
				reference: [phase("oni-selection", "ready")],
			}),
		).toEqual([]);
	});

	it("フェーズが届いていない（不具合の形）と、足りない種類とフェーズの違いを、問題として返す", () => {
		const missing = [of("stage"), of("doors"), of("members"), of("room-info")];
		expect(
			judgeArrival({
				arrived: missing,
				reference: [phase("oni-selection", "ready")],
			}),
		).toEqual([
			"届いていない種類: phase",
			"フェーズの中身が違う: 届いた なし・最初の参加者 oni-selection/ready/-",
		]);
	});

	it("フェーズが先へ進んでいれば、その時機の種類で判定する", () => {
		const prep = [
			of("stage"),
			of("doors"),
			phase("preparation", null, "a"),
			of("room-info"),
		];
		expect(
			judgeArrival({
				arrived: prep,
				reference: [phase("preparation", null, "a")],
			}),
		).toEqual([]);
	});
});

describe("作った人（作成の時点）と、メンバーの通知", () => {
	it("作成の時点の期待には、メンバーの通知を含めない（自分しか載らない一覧は送らない / ADR 0044）", () => {
		expect(expectedKinds("oni-selection", { atCreation: true })).toEqual([
			"doors",
			"phase",
			"room-info",
			"stage",
		]);
		const created = [
			of("stage"),
			of("doors"),
			phase("oni-selection", "waiting"),
			of("room-info"),
		];
		expect(
			judgeArrival({ arrived: created, reference: created, atCreation: true }),
		).toEqual([]);
		// 作成の時点でなければ（途中参加・復帰）、メンバーの通知が要る。
		expect(judgeArrival({ arrived: created, reference: created })).toEqual([
			"届いていない種類: members",
		]);
	});

	it("membersListed: 最後に届いたメンバーの通知に、ids の全員が載っているか", () => {
		const members = (ids: string[]) => ({
			type: "members",
			members: ids.map((playerId) => ({
				playerId,
				x: 0,
				z: 0,
				facing: null,
				pose: null,
			})),
		});
		expect(
			membersListed([members(["a"]), members(["a", "b"])], ["a", "b"]),
		).toBe(true);
		expect(
			membersListed([members(["a", "b"]), members(["a"])], ["a", "b"]),
		).toBe(false);
		expect(membersListed([of("stage")], ["a"])).toBe(false);
		expect(membersListed([{ type: "members", members: "x" }], ["a"])).toBe(
			false,
		);
	});
});
