import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import {
	BLINK_PERIOD_MS,
	PREPARATION_MS,
	SEND_INTERVAL_MS,
	WALK_MARGIN_MS,
	WALK_SPEED,
	blinkLevel,
	blinkTargets,
	farthestWalk,
	shouldReport,
} from "./motion";
import { parseStageNotice } from "./stage";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");

describe("歩く速さ（issue-29d）", () => {
	it("速さは 4.5 m/秒", () => {
		expect(WALK_SPEED).toBe(4.5);
	});

	it("farthestWalk: 玄関から、襖を全部開けた（準備移動の）道で、いちばん遠いマスまでの距離", () => {
		// 小さな屋敷: 玄関 (0,4) → 廊下を (1,1) まで 4 → 襖 (2,1) → (2,2) → 襖 (3,2) → (4,2) で 8 マス。
		expect(farthestWalk(tiny)).toBe(8);
	});

	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: いちばん遠いマスまで、準備移動の 20 秒から見回しの 5 秒を引いた時間で歩ける",
		(_id, notice) => {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			const seconds = farthestWalk(stage) / WALK_SPEED;
			expect(seconds * 1000).toBeLessThanOrEqual(
				PREPARATION_MS - WALK_MARGIN_MS,
			);
		},
	);
});

describe("shouldReport - 位置の報告を送るか（50 ms ごとに間引く）", () => {
	const base = {
		time: 1000,
		lastSent: 900,
		position: { x: 1, z: 1 },
		sentPosition: { x: 1, z: 1 },
		facing: 0,
		sentFacing: 0,
	};

	it("間隔は 50 ms", () => {
		expect(SEND_INTERVAL_MS).toBe(50);
	});

	it("動いたか、向きが 0.05 ラジアンより変わったときだけ、前の報告から 50 ms 空けて送る", () => {
		expect(shouldReport(base)).toBe(false);
		expect(shouldReport({ ...base, position: { x: 1.01, z: 1 } })).toBe(true);
		expect(shouldReport({ ...base, facing: 0.06 })).toBe(true);
		expect(shouldReport({ ...base, facing: 0.04 })).toBe(false);
		expect(
			shouldReport({ ...base, position: { x: 2, z: 1 }, lastSent: 951 }),
		).toBe(false);
		expect(
			shouldReport({ ...base, position: { x: 2, z: 1 }, lastSent: 950 }),
		).toBe(true);
	});

	it("まだ一度も送っていなければ送る", () => {
		expect(
			shouldReport({ ...base, sentPosition: null, sentFacing: null }),
		).toBe(true);
	});
});

describe("blinkTargets - 答え合わせで赤く点滅させる相手（ADR 0033）", () => {
	const hiders = ["b", "c", "d"];

	it("答え合わせ中は、探索の開始に届いた隠れ側全員（見つかった人も逃げ切った人も）。自分がいれば自分も", () => {
		expect(blinkTargets("reveal", hiders, "b")).toEqual({
			others: ["c", "d"],
			self: true,
		});
		expect(blinkTargets("reveal", hiders, "a")).toEqual({
			others: ["b", "c", "d"],
			self: false,
		});
	});

	it("答え合わせ以外、または一覧が届いていなければ、誰も点滅させない", () => {
		for (const phase of [
			"oni-selection",
			"preparation",
			"painting",
			"exploration",
			"ended",
		] as const) {
			expect(blinkTargets(phase, hiders, "b")).toEqual({
				others: [],
				self: false,
			});
		}
		expect(blinkTargets("reveal", null, "b")).toEqual({
			others: [],
			self: false,
		});
	});
});

describe("blinkLevel - 点滅の明るさ（0〜1、1秒周期）", () => {
	it("周期の始めは 0、半分で 1、周期ごとに繰り返す", () => {
		expect(BLINK_PERIOD_MS).toBe(1000);
		expect(blinkLevel(0, false)).toBeCloseTo(0);
		expect(blinkLevel(250, false)).toBeCloseTo(0.5);
		expect(blinkLevel(500, false)).toBeCloseTo(1);
		expect(blinkLevel(1500, false)).toBeCloseTo(1);
		expect(blinkLevel(2000, false)).toBeCloseTo(0);
	});

	it("いつも 0〜1 の間", () => {
		for (let t = 0; t < 3000; t += 37) {
			const level = blinkLevel(t, false);
			expect(level).toBeGreaterThanOrEqual(0);
			expect(level).toBeLessThanOrEqual(1);
		}
	});

	it("「視差効果を減らす」設定の人は、点滅させず、赤で光らせたまま（1）", () => {
		for (const t of [0, 250, 500, 999]) expect(blinkLevel(t, true)).toBe(1);
	});
});
