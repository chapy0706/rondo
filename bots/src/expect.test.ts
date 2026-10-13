import type { RealtimeResult, ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	checkGameEnded,
	checkMembers,
	checkMembersStopped,
	checkTargeted,
	formatTable,
} from "./expect.ts";
import type { Scenario } from "./scenario.ts";
import { details } from "./scenario.ts";

const scenario: Scenario = {
	name: "見本",
	bots: ["bot-a", "bot-b"],
	steps: [],
	receivers: ["bot-a", "bot-b"],
	rankings: [
		{ bot: "bot-b", rank: 1, score: 1, details: details.hiderWon },
		{ bot: "bot-a", rank: 2, score: 0, details: details.oniLost },
	],
};

const ids = new Map([
	["bot-a", "p-a"],
	["bot-b", "p-b"],
]);

const result: RealtimeResult = {
	order: "higher-is-better",
	rankings: [
		{
			playerId: "p-b",
			name: "bot-b",
			rank: 1,
			result: { score: 1, details: details.hiderWon },
		},
		{
			playerId: "p-a",
			name: "bot-a",
			rank: 2,
			result: { score: 0, details: details.oniLost },
		},
	],
};

const ended = (r: RealtimeResult = result): ServerMessage => ({
	type: "game-ended",
	gameType: "veryare",
	roomId: "room-1",
	result: r,
});

describe("checkGameEnded - game-ended の検査", () => {
	it("全員に、期待どおりの結果が届いていれば、問題なし", () => {
		const got = new Map([
			["bot-a", ended()],
			["bot-b", ended()],
		]);
		expect(checkGameEnded(scenario, ids, got)).toEqual([]);
	});

	it("届いていないボットを挙げる", () => {
		const got = new Map([["bot-a", ended()]]);
		expect(checkGameEnded(scenario, ids, got)).toEqual([
			"bot-b に game-ended が届かない",
		]);
	});

	it("順位・score・details・名前の食い違いを挙げる", () => {
		const wrong: RealtimeResult = {
			order: "higher-is-better",
			rankings: [
				{
					playerId: "p-b",
					name: "bot-x",
					rank: 2,
					result: { score: 0, details: { 結果: "負け" } },
				},
				{
					playerId: "p-a",
					name: "bot-a",
					rank: 2,
					result: { score: 0, details: details.oniLost },
				},
			],
		};
		const problems = checkGameEnded(
			scenario,
			ids,
			new Map([
				["bot-a", ended(wrong)],
				["bot-b", ended(wrong)],
			]),
		);
		expect(problems).toEqual([
			"bot-b の行が違う: 期待 1位 score 1 {役割:隠れる側, 結果:勝ち, 状態:逃げ切り} name bot-b / 実際 2位 score 0 {結果:負け} name bot-x",
		]);
	});

	it("期待にない人・足りない人・並び順を挙げる", () => {
		const extra: RealtimeResult = {
			order: "higher-is-better",
			rankings: [
				{
					playerId: "p-a",
					name: "bot-a",
					rank: 2,
					result: { score: 0, details: details.oniLost },
				},
				{
					playerId: "p-z",
					name: "someone",
					rank: 1,
					result: { score: 1 },
				},
			],
		};
		const problems = checkGameEnded(
			scenario,
			ids,
			new Map([
				["bot-a", ended(extra)],
				["bot-b", ended(extra)],
			]),
		);
		expect(problems).toContain("bot-b が結果にいない");
		expect(problems).toContain("期待にない人が結果にいる: someone");
		expect(problems).toContain("結果が順位の順に並んでいない");
	});

	it("ボットごとに結果が違えば挙げる（全員に同じ結果が届くはず）", () => {
		const other: RealtimeResult = { ...result, order: "lower-is-better" };
		const problems = checkGameEnded(
			scenario,
			ids,
			new Map([
				["bot-a", ended()],
				["bot-b", ended(other)],
			]),
		);
		expect(problems).toContain("bot-b の結果が bot-a と違う");
	});

	it("order が higher-is-better でなければ挙げる", () => {
		const lower: RealtimeResult = { ...result, order: "lower-is-better" };
		const problems = checkGameEnded(
			scenario,
			ids,
			new Map([
				["bot-a", ended(lower)],
				["bot-b", ended(lower)],
			]),
		);
		expect(problems).toContain(
			"order が higher-is-better でない: lower-is-better",
		);
	});
});

const targeted = (to: string): ServerMessage => ({
	type: "game-state-to",
	gameType: "veryare",
	roomId: "room-1",
	to,
	payload: { type: "phase" },
});

describe("checkTargeted - 限定配信（ADR 0021）", () => {
	it("宛先が自分の限定配信だけが届いていれば、問題なし", () => {
		expect(
			checkTargeted([
				{ name: "bot-a", playerId: "p-a", messages: [] },
				{ name: "bot-c", playerId: "p-c", messages: [targeted("p-c")] },
			]),
		).toEqual([]);
	});

	it("宛先でないボットに届いたら挙げる", () => {
		expect(
			checkTargeted([
				{ name: "bot-a", playerId: "p-a", messages: [targeted("p-c")] },
				{ name: "bot-c", playerId: "p-c", messages: [targeted("p-c")] },
			]),
		).toEqual(["bot-a に、宛先 p-c の限定配信が届いた"]);
	});

	it("1通も観測できなければ、確認できなかったとして挙げる", () => {
		expect(
			checkTargeted([{ name: "bot-a", playerId: "p-a", messages: [] }]),
		).toEqual(["限定配信が1通も観測できず、確認できない"]);
	});
});

describe("formatTable - 結果の表", () => {
	it("シナリオごとに、結果・時間・問題を1行で出す", () => {
		const table = formatTable([
			{ name: "時間切れ", ok: true, ms: 6120, problems: [] },
			{ name: "不成立", ok: false, ms: 900, problems: ["a", "b"] },
		]);
		expect(table).toBe(
			[
				"| シナリオ | 結果 | 時間 | 問題 |",
				"| --- | --- | --- | --- |",
				"| 時間切れ | 成功 | 6.1秒 |  |",
				"| 不成立 | 失敗 | 0.9秒 | a / b |",
			].join("\n"),
		);
	});
});

describe("待機ルームのメンバーの確かめ（issue-59）", () => {
	const members = (
		list: readonly {
			playerId: string;
			x: number;
			z: number;
			pose: string | null;
		}[],
	): ServerMessage => ({
		type: "game-state",
		gameType: "veryare",
		roomId: "room-1",
		payload: {
			type: "members",
			members: list.map((m) => ({ ...m, facing: null })),
		},
	});
	const phase = (name: string): ServerMessage => ({
		type: "game-state",
		gameType: "veryare",
		roomId: "room-1",
		payload: { type: "phase", phase: name },
	});
	const b = { playerId: "p-b", x: 1.5, z: 1, pose: "femaleDance" };
	const expected = [{ playerId: "p-b", x: 1.5, z: 1, pose: "femaleDance" }];

	it("全員の最新のメンバーの通知が同じで、期待する位置とポーズなら、問題なし", () => {
		const log = [members([{ ...b, x: 0, pose: null }]), members([b])];
		expect(
			checkMembers(
				"同期",
				expected,
				new Map([
					["bot-a", log],
					["bot-b", [members([b])]],
				]),
			),
		).toEqual([]);
	});

	it("届いていない・位置やポーズが違う・人によって違うなら、確かめの名前を添えて問題にする", () => {
		const problems = checkMembers(
			"同期",
			expected,
			new Map([
				["bot-a", [members([{ ...b, x: 1.6 }])]],
				["bot-b", [members([{ ...b, pose: null }])]],
				["bot-c", []],
			]),
		);
		expect(problems).toEqual([
			"同期: bot-a に届いた p-b は (1.6, 1)・femaleDance（期待は (1.5, 1)・femaleDance）",
			"同期: bot-b に届いた p-b は (1.5, 1)・null（期待は (1.5, 1)・femaleDance）",
			"同期: bot-c にメンバーの通知が届いていない",
			"同期: 最新のメンバーの通知が、ボットによって違う",
		]);
	});

	it("鬼選出の後（フェーズが変わった後）に届いた待機の通知は、問題にする", () => {
		expect(
			checkMembersStopped("bot-a", [
				members([b]),
				phase("oni-selection"),
				members([b]),
				phase("preparation"),
				phase("painting"),
			]),
		).toEqual([]);
		expect(
			checkMembersStopped("bot-a", [
				phase("preparation"),
				members([b]),
				members([b]),
			]),
		).toEqual(["bot-a に、鬼選出の後で待機の通知が 2 通届いた"]);
	});
});
