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

/**
 * 壁越し・閉じた襖越しの射撃は外れ、開けた襖越しの射撃は当たる、を確かめる手順（issue-29b）。
 * マスは plan.ts の pickDoorShot が選ぶ（骨格でも平屋でも同じ手順 / issue-45）。
 */
const doorShotSteps: Step[] = [
	{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
	{
		on: { phase: "preparation" },
		bot: "bot-b",
		action: { type: "go", to: "r", doors: "open" },
	},
	{
		on: { phase: "preparation" },
		bot: "bot-c",
		action: { type: "go", to: "s", doors: "open" },
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "go", to: "w", doors: "closed" },
		delayMs: 50,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "shoot", target: "bot-b" },
		delayMs: 150,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: {
			type: "expect-hiding",
			check: "壁越しの射撃は外れる",
			target: "bot-b",
			hiding: true,
		},
		delayMs: 270,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "go", to: "c", doors: "closed" },
		delayMs: 350,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "shoot", target: "bot-c" },
		delayMs: 450,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: {
			type: "expect-hiding",
			check: "閉じた襖越しの射撃は外れる",
			target: "bot-c",
			hiding: true,
		},
		delayMs: 570,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "open-door" },
		delayMs: 650,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: { type: "shoot", target: "bot-c" },
		delayMs: 800,
	},
	{
		on: { phase: "exploration" },
		bot: "bot-a",
		action: {
			type: "expect-hiding",
			check: "開けた襖越しの射撃は当たる",
			target: "bot-c",
			hiding: false,
		},
		delayMs: 920,
	},
];

/** 壁越し・襖越しの射撃の結果。B は最後まで隠れ、C は開けた襖越しに見つかる。 */
const doorShotRankings = [
	hider("bot-b", true),
	{ bot: "bot-c", rank: 1, score: 1, details: details.hiderWonFound },
	oni("bot-a", false),
];

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
		// 名前つきで作り、整えた名前が一覧に載ることも確かめる（issue-58）。HTML の記号は
		// そのまま、前後の空白は落ちる。
		roomName: "\u3000<b>ボット</b>&部屋  ",
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{ on: { phase: "preparation" }, bot: "bot-a", action: { type: "leave" } },
		],
		receivers: ["bot-b", "bot-c"],
		rankings: [hider("bot-b", true), hider("bot-c", true), oni("bot-a", false)],
	},
	{
		// 待機ルームの同期（issue-59 / ADR 0044）。B と C が待機ルームで動き、B が待機ポーズを変える。
		// 全員に同じ位置とポーズが届くことを確かめてから、A が立候補して鬼になり、準備移動で退出する。
		// 鬼選出の後には、待機の通知がどのボットにも届かないことも確かめる。
		name: "待機ルームのメンバーの同期",
		bots: ["bot-a", "bot-b", "bot-c"],
		waitingSync: true,
		steps: [
			{ on: "joined", bot: "bot-b", action: { type: "move", x: 1.5, z: 1 } },
			{ on: "joined", bot: "bot-c", action: { type: "move", x: -1, z: -2 } },
			{
				on: "joined",
				bot: "bot-b",
				action: { type: "waiting-pose", pose: "femaleDance" },
				delayMs: 50,
			},
			{
				on: "joined",
				bot: "bot-a",
				action: {
					type: "expect-members",
					check: "待機の同期",
					members: [
						{ bot: "bot-b", x: 1.5, z: 1, pose: "femaleDance" },
						{ bot: "bot-c", x: -1, z: -2, pose: null },
					],
				},
				delayMs: 800,
			},
			{
				on: "joined",
				bot: "bot-a",
				action: { type: "touch-area" },
				delayMs: 1000,
			},
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
	{
		// 壁越し・閉じた襖越しの射撃は外れ、開けた襖越しの射撃は当たる（issue-29b）。
		// 部屋を1つ選び（plan.ts の pickDoorShot）、隠れ側 B は部屋の壁際（r）、C は襖の内側（s）へ、
		// 襖が全部開いている準備移動の間に歩く。探索（襖は全部閉じる）で、鬼 A は玄関から歩いて、
		// 壁の向こう（w）から B を撃ち、襖の前（c）へ移って、閉じたまま C を撃ち、襖を開けて C を撃つ。
		// 外れの確かめは、撃ってから 120 ms の間（縮めた撃つ間隔 150 ms の内側）に、隠れている
		// 一覧が変わらないこと。B は最後まで隠れているので、時間切れで隠れ側の勝ち（C は発見）。
		name: "壁越し・襖越しの射撃",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: doorShotSteps,
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: doorShotRankings,
	},
	{
		// ペイントの確定と一括配信（issue-25）。隠れ側 B がペイントフェーズに2回塗りを送り、
		// 探索の開始に鬼 A へ届いた一括配信で、最初の1回だけが載っていることを確かめる。
		// 誰も撃たないので、時間切れで隠れ側の勝ち。
		name: "ペイントの確定と一括配信",
		bots: ["bot-a", "bot-b"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "paint", color: "#a07850" },
				delayMs: 50,
			},
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "paint", color: "#6b5440" },
				delayMs: 150,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-paint",
					check: "最初のペイントだけが届く",
					target: "bot-b",
					color: "#a07850",
				},
				delayMs: 100,
			},
		],
		receivers: ["bot-a", "bot-b"],
		rankings: [hider("bot-b", true), oni("bot-a", false)],
	},
	{
		// 平屋の固定ステージ（issue-44）で、3人。隠れ側は玄関から別々の場所へ動き、探索が
		// 時間切れになる。ステージの通知に平屋のデータ（1マス 0.3 m・玄関 (4.7, 11.3)）が載り、
		// 襖10組（辺 108 本）は、準備移動で全部開き、探索の開始で全部閉じ、答え合わせの開始で
		// 全部開く。襖の通知はフェーズの通知の後に届くので、確かめは少し待ってから行う。
		name: "平屋のステージで時間切れ",
		settings: { stage: 1 },
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			...hide(["bot-b", "bot-c"]),
			{
				on: { phase: "preparation" },
				bot: "bot-a",
				action: {
					type: "expect-stage",
					check: "平屋のステージの通知",
					cellSize: 0.3,
					spawn: { x: 4.7, z: 11.3 },
				},
			},
			{
				on: { phase: "preparation" },
				bot: "bot-a",
				action: {
					type: "expect-doors",
					check: "準備移動の間、襖は全部開いている",
					open: 108,
				},
				delayMs: 100,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-doors",
					check: "探索の開始で、襖が全部閉じる",
					open: 0,
				},
				delayMs: 100,
			},
			{
				on: { phase: "reveal" },
				bot: "bot-b",
				action: {
					type: "expect-doors",
					check: "答え合わせの開始で、襖が全部開く",
					open: 108,
				},
				delayMs: 100,
			},
		],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: [hider("bot-b", true), hider("bot-c", true), oni("bot-a", false)],
	},
	{
		// 平屋（issue-45）で、同じ手順を通す。平屋には「廊下」という領域が無く、マスは 0.3 m。
		// pickDoorShot は、和室C と東の廊下の襖（s・c）と、和室C の北東の隅の壁（r・w）を選ぶ。
		// 鬼は玄関から東の廊下を歩くだけで c・w に着く（襖を通らない）。
		name: "平屋の壁越し・襖越しの射撃",
		settings: { stage: 1 },
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: doorShotSteps,
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: doorShotRankings,
	},
	{
		// ポーズの確定と一括配信（issue-56）。隠れ側 B がペイントフェーズに、塗らずにポーズだけを2回
		// 確定し、探索の開始に鬼 A へ届いた一括配信で、最初の1回（maleCrouch）だけが載っていることを
		// 確かめる。C は確定しないので null（既定の立ち姿）。誰も撃たないので、時間切れで隠れ側の勝ち。
		name: "ポーズの確定と一括配信",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			...hide(["bot-b", "bot-c"]),
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "pose", pose: "maleCrouch" },
				delayMs: 50,
			},
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "pose", pose: "femaleDance" },
				delayMs: 150,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-pose",
					check: "最初のポーズだけが届く",
					target: "bot-b",
					pose: "maleCrouch",
				},
				delayMs: 100,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-pose",
					check: "確定しなかった人のポーズは null",
					target: "bot-c",
					pose: null,
				},
				delayMs: 120,
			},
		],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: [hider("bot-b", true), hider("bot-c", true), oni("bot-a", false)],
	},
];

/** 広い屋敷だけ（issue-65）の作成時の設定。サーバーを RONDO_WIDE_DEV=1 で動かすときだけ受け付けられる。 */
const wide = { stage: 3 } as const;

/** 広い屋敷の確かめ。探索は、ルームで選んだ時間（既定 40 秒）に +80 秒。 */
const expectWide = (bot: string): Step => ({
	on: { phase: "preparation" },
	bot,
	action: {
		type: "expect-wide",
		check: "広い屋敷のステージと、+80 秒の探索時間",
		explorationSeconds: 40 + 80,
	},
});

/**
 * 広い屋敷だけ（stage 3 / issue-65）で、時間切れ・全員発見・壁越しと襖越しの射撃を通す。既存の
 * シナリオ（scenarios）と同じ手順で、作成時の設定だけが違う。サーバーは RONDO_WIDE_DEV=1 で動かす
 * （tools/bots.sh）。手順の時刻は、既存のシナリオと同じ（探索は、縮めても 6 秒あり、既存の見積もりの
 * 2 秒より長い）。
 */
export const wideScenarios: readonly Scenario[] = [
	{
		name: "広い屋敷で時間切れ",
		settings: wide,
		bots: ["bot-a", "bot-b", "bot-c", "bot-d", "bot-e"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			...hide(["bot-b", "bot-c", "bot-d", "bot-e"]),
			expectWide("bot-a"),
		],
		receivers: ["bot-a", "bot-b", "bot-c", "bot-d", "bot-e"],
		rankings: [
			hider("bot-b", true),
			hider("bot-c", true),
			hider("bot-d", true),
			hider("bot-e", true),
			oni("bot-a", false),
		],
	},
	{
		name: "広い屋敷で全員発見",
		settings: wide,
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			...hide(["bot-b", "bot-c"]),
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			expectWide("bot-a"),
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
	{
		name: "広い屋敷の壁越し・襖越しの射撃",
		settings: wide,
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [...doorShotSteps, expectWide("bot-a")],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: doorShotRankings,
	},
];

/** make bots で流す、すべてのシナリオ（既存のシナリオの後に、広い屋敷）。 */
/**
 * 結果のあと、ルームが閉じる（issue-70）。時間切れで結果まで進め、結果のあと、閉じるまで（縮めた 3 分 =
 * 9 秒）待つ。既存のシナリオの一覧（scenarios.test.ts）を変えないよう、別の配列に置く。make bots は、
 * allScenarios の後に流す（main.ts）。
 */
export const expiryScenarios: readonly Scenario[] = [
	{
		name: "結果のあと、ルームが閉じる",
		bots: ["bot-a", "bot-b"],
		expiry: true,
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			...hide(["bot-b"]),
		],
		receivers: ["bot-a", "bot-b"],
		rankings: [hider("bot-b", true), oni("bot-a", false)],
	},
];

export const allScenarios: readonly Scenario[] = [
	...scenarios,
	...wideScenarios,
];
