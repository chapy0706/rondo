/**
 * veryare のシナリオ（issue-49 / issue-27）。
 *
 * サーバーは、フェーズ時間を縮めて動かす（RONDO_TEST_PHASE_DIVISOR）。手順の引き金は
 * 時間ではなく、通知（フェーズ・鬼希望エリアの色）にしてあるので、縮め方に依らない。
 */

import { type Scenario, type Step, details } from "./scenario.ts";

const hider = (bot: string, won: boolean) => ({
	bot,
	rank: won ? 1 : 2,
	score: won ? 1 : 0,
	details: won ? details.hiderWon : details.hiderLost,
});

/** 準備移動の始まりに、隠れ側を別々の場所へ動かす手順（並んだ順に 0, 1, 2…番目の場所）。 */
const hide = (bots: readonly string[]): Step[] =>
	bots.map((bot, index) => ({
		on: { phase: "preparation" },
		bot,
		action: { type: "hide", index },
	}));

const oni = (bot: string, won: boolean) => ({
	bot,
	rank: won ? 1 : 2,
	score: won ? 1 : 0,
	details: won ? details.oniWon : details.oniLost,
});

export const scenarios: readonly Scenario[] = [
	{
		// 5人。A が鬼に立候補し、誰も見つからないまま探索が時間切れになる。
		// 3人目以降の参加ではエリアの色が変わらないので、参加した本人にだけ今の状態が
		// 限定配信で届く（ADR 0021 の確認に使う）。
		name: "時間切れで隠れ側の勝ち",
		bots: ["bot-a", "bot-b", "bot-c", "bot-d", "bot-e"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			// 全員が玄関に現れるので、隠れ側は別々の場所へ動く（issue-29a）。
			...hide(["bot-b", "bot-c", "bot-d", "bot-e"]),
		],
		receivers: ["bot-a", "bot-b", "bot-c", "bot-d", "bot-e"],
		rankings: [
			hider("bot-b", true),
			hider("bot-c", true),
			hider("bot-d", true),
			hider("bot-e", true),
			oni("bot-a", false),
		],
		targeted: true,
	},
	{
		// 鬼が準備移動の間に退出する。隠れ側の勝ちで、退出した鬼も結果に残る。
		name: "鬼の離脱で隠れ側の勝ち",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{ on: { phase: "preparation" }, bot: "bot-a", action: { type: "leave" } },
		],
		receivers: ["bot-b", "bot-c"],
		rankings: [hider("bot-b", true), hider("bot-c", true), oni("bot-a", false)],
	},
	{
		// 2人でカウントが始まった後に1人が抜け、鬼選出の時点で1人になる。
		name: "人数が足りず不成立",
		bots: ["bot-a", "bot-b"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{
				on: { phase: "oni-selection", area: "counting" },
				bot: "bot-b",
				action: { type: "leave" },
			},
		],
		receivers: ["bot-a"],
		rankings: [{ bot: "bot-a", rank: 1, score: 0, details: details.void }],
	},
	{
		// 隠れ側の2人が玄関にとどまる。全員が玄関に現れる（issue-29a）ので、準備移動の
		// 終わりの被りの判定で全員失格になる。
		name: "被りによる全員失格で鬼の勝ち",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{ on: { phase: "preparation" }, bot: "bot-b", action: { type: "stay" } },
			{ on: { phase: "preparation" }, bot: "bot-c", action: { type: "stay" } },
		],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: [
			oni("bot-a", true),
			hider("bot-b", false),
			hider("bot-c", false),
		],
	},
	{
		// 人間の鬼役の A が、探索の始まりに隠れ側を1人ずつ撃って、全員を見つける（issue-27）。
		// 隠れ側は、玄関から一直線にたどれる 7 m 以内の場所へ動き（issue-29a）、鬼は玄関から
		// 始まるので、どちらも射程 8 m の内側。一直線なので、見通し（issue-29b）も通る。撃つ間隔（縮めて 150 ms）を空け、縮めた探索（2 秒）が終わる前に撃ち終える
		// （scenarios.test.ts で確かめる）。
		name: "全員発見で鬼の勝ち",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			...hide(["bot-b", "bot-c"]),
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "shoot", target: "bot-b" },
				delayMs: 100,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "shoot", target: "bot-c" },
				delayMs: 600,
			},
		],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: [
			oni("bot-a", true),
			hider("bot-b", false),
			hider("bot-c", false),
		],
	},
];
