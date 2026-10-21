import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { checkSpectateStream } from "./spectate.ts";
import type { StageMap } from "./stage.ts";

/** 幅 4 × 奥行き 4 マス（1 m）、原点 (0, 0) の地図。 */
const map: StageMap = {
	cellSize: 1,
	origin: { x: 0, z: 0 },
	width: 4,
	depth: 4,
	rows: [],
	regions: {},
	doors: new Map(),
	spawn: { x: 0.5, z: 3.5 },
};

const state = (payload: unknown): ServerMessage => ({
	type: "game-state",
	gameType: "veryare",
	roomId: "r",
	payload,
});
const started: ServerMessage = {
	type: "game-started",
	gameType: "veryare",
	roomId: "r",
};
const looks = [
	{
		playerId: "cpu-2",
		pose: "lying",
		paint: { kind: "uniform", color: "#c2b280" },
	},
	{
		playerId: "cpu-3",
		pose: "crouching",
		paint: { kind: "uniform", color: "#a8956a" },
	},
];
const actor = (id: string, x: number, pose: string) => ({
	playerId: id,
	x,
	z: 1,
	facing: 0,
	pose,
});

const context = {
	players: ["cpu-1", "cpu-2", "cpu-3"],
	hiderCpus: 2,
	stageOf: () => map,
};

function frames(messages: ServerMessage[], step = 100) {
	return messages.map((message, i) => ({ at: i * step, message }));
}

describe("checkSpectateStream - ボットの観戦者が受け取った観戦用の通知（issue-67）", () => {
	const good = [
		state({
			type: "spectate",
			actors: [actor("cpu-2", 0.5, "walking"), actor("cpu-3", 0.5, "walking")],
			looks,
		}),
		state({
			type: "spectate",
			actors: [actor("cpu-2", 1.5, "walking"), actor("cpu-3", 2, "crouching")],
		}),
		state({
			type: "spectate",
			actors: [
				actor("cpu-2", 2.5, "lying"),
				actor("cpu-3", 2, "crouching"),
				actor("cpu-1", 0.5, "standing"),
			],
		}),
		started,
		state({
			type: "spectate",
			actors: [actor("cpu-2", 0.5, "walking"), actor("cpu-3", 0.5, "walking")],
			looks,
		}),
		state({
			type: "spectate",
			actors: [actor("cpu-2", 1, "walking"), actor("cpu-3", 1, "walking")],
		}),
	];

	it("正しい流れなら、問題なし。試合ごとの通知の数と、通知の間隔を数える", () => {
		const result = checkSpectateStream(frames(good), context);
		expect(result.problems).toEqual([]);
		expect(result.noticesPerGame).toEqual([3, 2]);
		expect(result.gapsMs).toEqual([100, 100, 100]);
		expect(result.gamesWithLooks).toBe(2);
	});

	it("参加者でない人・ステージの外・知らないポーズは、問題", () => {
		const bad = [
			state({
				type: "spectate",
				actors: [actor("p-9", 0.5, "walking")],
				looks,
			}),
			state({ type: "spectate", actors: [actor("cpu-2", 9, "walking")] }),
			state({ type: "spectate", actors: [actor("cpu-2", 1, "femaleDance")] }),
		];
		const { problems } = checkSpectateStream(frames(bad), context);
		expect(problems).toContain("参加者でない人が載っている: p-9");
		expect(problems).toContain("ステージの外: cpu-2 (9, 1)");
		expect(problems).toContain("形が違う通知");
	});

	it("着いた隠れ CPU のポーズが、色とポーズ（looks）と違えば、問題", () => {
		const bad = [
			state({
				type: "spectate",
				actors: [actor("cpu-2", 1, "standing")],
				looks,
			}),
		];
		expect(checkSpectateStream(frames(bad), context).problems).toContain(
			"ポーズが見た目と違う: cpu-2 standing（見た目は lying）",
		);
	});

	it("looks の数・色の形が違えば、問題。looks の無い試合は数えない", () => {
		const bad = [
			state({
				type: "spectate",
				actors: [],
				looks: [
					{
						playerId: "cpu-2",
						pose: "lying",
						paint: { kind: "uniform", color: "red" },
					},
				],
			}),
			started,
			state({ type: "spectate", actors: [] }),
		];
		const result = checkSpectateStream(frames(bad), context);
		expect(result.problems).toContain("見た目の数が隠れ CPU の数と違う: 1");
		expect(result.problems).toContain("色の形が違う: cpu-2 red");
		expect(result.gamesWithLooks).toBe(1);
	});

	it("間隔が 100 ms より明らかに短い通知は、問題（80 ms 未満）", () => {
		const fast = frames(good.slice(0, 3), 50);
		expect(checkSpectateStream(fast, context).problems).toContain(
			"通知の間隔が短すぎる: 50 ms",
		);
	});
});
