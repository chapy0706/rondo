import type { PlayerInfo, VeryareSpectateNotice } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import spectateFixture from "../../../../../packages/contracts/src/fixtures/veryare-spectate.json";
import { yawOfFacing } from "./rules";
import {
	EMPTY_SPECTATE,
	NEXT_GAME_MS,
	SPECTATE_DELAY_MS,
	actorChosenPose,
	applySpectateNotice,
	cameraTarget,
	carryFollow,
	followChoices,
	followYaw,
	isSpectating,
	nextGameSeconds,
	parseSpectateNotice,
	sampleSpectate,
	spectateStatus,
} from "./spectate";

const players: PlayerInfo[] = [
	{ playerId: "cpu-1", name: "CPU 1" },
	{ playerId: "cpu-2", name: "CPU 2" },
	{ playerId: "cpu-3", name: "CPU 3" },
	{ playerId: "cpu-4", name: "CPU 4" },
];

function notice(
	actors: VeryareSpectateNotice["actors"],
	looks?: VeryareSpectateNotice["looks"],
): VeryareSpectateNotice {
	return looks === undefined
		? { type: "spectate", actors }
		: { type: "spectate", actors, looks };
}

describe("parseSpectateNotice - 観戦用の通知の読み取り（issue-67）", () => {
	it("契約の見本の valid は、すべて読める（形はそのまま）", () => {
		for (const sample of spectateFixture.spectateNotice.valid) {
			expect(parseSpectateNotice(sample)).toEqual(sample);
		}
	});

	it("契約の見本の invalid は、すべて拒む", () => {
		for (const sample of spectateFixture.spectateNotice.invalid) {
			expect(parseSpectateNotice(sample)).toBeNull();
		}
	});
});

describe("isSpectating - 観戦者か（issue-67）", () => {
	it("観戦ルームでは、参加者は CPU だけで、自分は載らない", () => {
		expect(isSpectating("p-9", players)).toBe(true);
	});

	it("対戦のルームでは、自分も参加者に載る。ルームに入る前は観戦ではない", () => {
		expect(isSpectating("cpu-2", players)).toBe(false);
		expect(isSpectating(null, players)).toBe(false);
		expect(isSpectating("p-9", [])).toBe(false);
	});
});

describe("全員の体の補間（track.ts の使い回し / issue-67）", () => {
	const walking = { playerId: "cpu-2", facing: 0, pose: "walking" } as const;

	it("届いた通知を、遅らせた時刻の位置で、前後の通知から直線で補間する", () => {
		let view = applySpectateNotice(
			EMPTY_SPECTATE,
			notice([{ ...walking, x: 0, z: 0 }]),
			1000,
		);
		view = applySpectateNotice(
			view,
			notice([{ ...walking, x: 1, z: 0 }]),
			1100,
		);
		const [actor] = sampleSpectate(view, 1050 + SPECTATE_DELAY_MS);
		expect(actor?.id).toBe("cpu-2");
		expect(actor?.x).toBeCloseTo(0.5);
		expect(actor?.pose).toBe("walking");
	});

	it("通知に載らなくなった人は消す。色は looks から、無ければ null", () => {
		let view = applySpectateNotice(
			EMPTY_SPECTATE,
			notice(
				[
					{ ...walking, x: 0, z: 0 },
					{ playerId: "cpu-3", x: 2, z: 2, facing: 0, pose: "walking" },
				],
				[
					{
						playerId: "cpu-2",
						pose: "lying",
						paint: { kind: "uniform", color: "#c2b280" },
					},
				],
			),
			0,
		);
		expect(sampleSpectate(view, 500).map((a) => [a.id, a.color])).toEqual([
			["cpu-2", "#c2b280"],
			["cpu-3", null],
		]);
		view = applySpectateNotice(view, notice([{ ...walking, x: 1, z: 0 }]), 100);
		// looks の無い通知では、色をそのまま保つ。
		expect(sampleSpectate(view, 500).map((a) => [a.id, a.color])).toEqual([
			["cpu-2", "#c2b280"],
		]);
	});

	it("looks のある通知（次の試合の始まり・入室）では、前の位置から補間しない（玄関へ滑らない）", () => {
		let view = applySpectateNotice(
			EMPTY_SPECTATE,
			notice([{ ...walking, x: 9, z: 9 }]),
			0,
		);
		view = applySpectateNotice(
			view,
			notice(
				[{ ...walking, x: 0, z: 0 }],
				[
					{
						playerId: "cpu-2",
						pose: "lying",
						paint: { kind: "uniform", color: "#a8956a" },
					},
				],
			),
			100,
		);
		const [actor] = sampleSpectate(view, 100);
		expect(actor?.x).toBe(0);
		expect(actor?.color).toBe("#a8956a");
	});
});

describe("actorChosenPose - 動きの決め方（issue-57 の使い回し）", () => {
	it("walking は、ポーズではなく、歩く動き（選んだポーズなし。速さから歩く・走るを決める）", () => {
		expect(actorChosenPose("walking")).toBeNull();
	});

	it("隠れ場所のポーズは、素材のポーズに対応づける（止まってから、そのポーズへ移る）", () => {
		expect(actorChosenPose("lying")).not.toBeNull();
		expect(actorChosenPose("crouching")).not.toBeNull();
		expect(actorChosenPose("lying")).not.toBe(actorChosenPose("crouching"));
	});
});

describe("followChoices - 追う相手の選択肢とラベル", () => {
	it("鬼が先で、隠れ CPU は参加者の一覧の順に「隠れ 1」「隠れ 2」…", () => {
		expect(followChoices(players, "cpu-1")).toEqual([
			{ id: "cpu-1", label: "鬼" },
			{ id: "cpu-2", label: "隠れ 1" },
			{ id: "cpu-3", label: "隠れ 2" },
			{ id: "cpu-4", label: "隠れ 3" },
		]);
	});

	it("鬼が参加者の一覧の途中でも、隠れの番号は、鬼を除いた順", () => {
		expect(followChoices(players, "cpu-3").map((c) => c.label)).toEqual([
			"鬼",
			"隠れ 1",
			"隠れ 2",
			"隠れ 3",
		]);
		expect(followChoices(players, "cpu-3")[0]?.id).toBe("cpu-3");
	});

	it("鬼が分からなければ、全員を「隠れ」の番号で並べる", () => {
		expect(followChoices(players, null).map((c) => c.label)).toEqual([
			"隠れ 1",
			"隠れ 2",
			"隠れ 3",
			"隠れ 4",
		]);
	});
});

describe("carryFollow - 試合が替わったときの引き継ぎ", () => {
	const choices = followChoices(players, "cpu-1");

	it("選んだ相手が、新しい試合にもいれば、保つ", () => {
		expect(carryFollow("cpu-3", choices)).toBe("cpu-3");
	});

	it("いなければ（まだ選んでいないときも）、鬼", () => {
		expect(carryFollow("cpu-9", choices)).toBe("cpu-1");
		expect(carryFollow(null, choices)).toBe("cpu-1");
	});

	it("選択肢が無ければ null", () => {
		expect(carryFollow("cpu-3", [])).toBeNull();
	});
});

describe("cameraTarget - カメラが追う体", () => {
	it("選んだ相手がステージにいれば、その人", () => {
		expect(cameraTarget("cpu-3", ["cpu-2", "cpu-3"])).toBe("cpu-3");
	});

	it("まだステージにいなければ（準備移動の鬼）、ステージにいる最初の人。誰もいなければ null", () => {
		expect(cameraTarget("cpu-1", ["cpu-2", "cpu-3"])).toBe("cpu-2");
		expect(cameraTarget("cpu-1", [])).toBeNull();
		expect(cameraTarget(null, ["cpu-4"])).toBe("cpu-4");
	});
});

describe("followYaw - 追う相手の後ろへ、カメラの向きを寄せる", () => {
	it("相手の向きの背後（yawOfFacing）へ、少しずつ寄せ、行き過ぎない", () => {
		const target = yawOfFacing(Math.PI / 2);
		const step = followYaw(0, Math.PI / 2, 0.1);
		expect(Math.abs(step - target)).toBeLessThan(Math.abs(0 - target));
		const settled = Array.from({ length: 200 }).reduce<number>(
			(yaw) => followYaw(yaw, Math.PI / 2, 0.05),
			0,
		);
		expect(settled).toBeCloseTo(target, 3);
	});

	it("近い回り方で寄せる（π をまたいでも、遠回りしない）", () => {
		const from = Math.PI - 0.1;
		const facing = Math.atan2(
			-Math.cos(-Math.PI + 0.1),
			-Math.sin(-Math.PI + 0.1),
		);
		const next = followYaw(from, facing, 0.05);
		const turned = Math.atan2(Math.sin(next - from), Math.cos(next - from));
		expect(turned).toBeGreaterThan(0);
		expect(turned).toBeLessThan(0.2);
	});

	it("dt が 0 なら変えない", () => {
		expect(followYaw(0.3, 1, 0)).toBe(0.3);
	});
});

describe("nextGameSeconds - 次の試合まで あと ○ 秒", () => {
	it("結果を受け取った時刻から、10 秒を数える（切り上げ。0 未満にしない）", () => {
		expect(NEXT_GAME_MS).toBe(10_000);
		expect(nextGameSeconds(1000, 1000)).toBe(10);
		expect(nextGameSeconds(1000, 1001)).toBe(10);
		expect(nextGameSeconds(1000, 2000)).toBe(9);
		expect(nextGameSeconds(1000, 10_500)).toBe(1);
		expect(nextGameSeconds(1000, 99_000)).toBe(0);
	});
});

describe("spectateStatus - 状態の行（フェーズと残り時間）", () => {
	it("フェーズと残り時間", () => {
		expect(
			spectateStatus({
				phase: "preparation",
				remainingSeconds: 12,
				outcome: null,
				nextGameSeconds: null,
			}),
		).toBe("準備移動 ・残り 12秒");
		expect(
			spectateStatus({
				phase: "exploration",
				remainingSeconds: null,
				outcome: null,
				nextGameSeconds: null,
			}),
		).toBe("探索");
	});

	it("答え合わせは、勝敗を添える", () => {
		expect(
			spectateStatus({
				phase: "reveal",
				remainingSeconds: 5,
				outcome: "hiders-win",
				nextGameSeconds: null,
			}),
		).toBe("答え合わせ ・隠れる側の勝ち ・残り 5秒");
	});

	it("結果のときは、次の試合までの残りを出す", () => {
		expect(
			spectateStatus({
				phase: "ended",
				remainingSeconds: null,
				outcome: "oni-wins",
				nextGameSeconds: 7,
			}),
		).toBe("結果 ・鬼の勝ち ・次の試合まで あと 7 秒");
		expect(
			spectateStatus({
				phase: "ended",
				remainingSeconds: null,
				outcome: "oni-wins",
				nextGameSeconds: 0,
			}),
		).toBe("結果 ・鬼の勝ち ・まもなく次の試合");
	});

	it("フェーズが届く前は、待っていることを出す", () => {
		expect(
			spectateStatus({
				phase: null,
				remainingSeconds: null,
				outcome: null,
				nextGameSeconds: null,
			}),
		).toBe("試合の始まりを待っています");
	});
});
