import { describe, expect, it } from "vitest";
import {
	COUNT_ONCE_MIN_MS,
	PAINT_TICK_MS,
	SHOT_RESULT_WINDOW_MS,
	countActive,
	countPlan,
	foundSelf,
	gameBgm,
	openShot,
	paintPlan,
	paintRate,
	shotHit,
	shotMissed,
	startSignal,
} from "./sound";

describe("場面と BGM（veryare / issue-63）", () => {
	it("鬼選出は top、準備移動から答え合わせまでは game、終了は無音", () => {
		expect(gameBgm("oni-selection")).toBe("bgm-top");
		for (const phase of [
			"preparation",
			"painting",
			"exploration",
			"reveal",
		] as const) {
			expect(gameBgm(phase)).toBe("bgm-game");
		}
		expect(gameBgm("ended")).toBeNull();
	});
});

describe("カウントダウンの音（count）", () => {
	it("カウント中は、鬼選出で、エリアが counting のときだけ", () => {
		expect(countActive("oni-selection", "counting")).toBe(true);
		expect(countActive("oni-selection", "ready")).toBe(false);
		expect(countActive("oni-selection", null)).toBe(false);
		expect(countActive("preparation", "counting")).toBe(false);
	});

	it("8 秒以上の素材: 始まりに 1 回。素材の終わりを 0 秒にそろえる", () => {
		expect(COUNT_ONCE_MIN_MS).toBe(8000);
		// 13.98 秒の素材と 10 秒のカウント: 素材の 3.98 秒から鳴らす。
		expect(countPlan(13_984, 10_000)).toEqual({
			kind: "once",
			offsetMs: 3984,
			delayMs: 0,
		});
	});

	it("途中から入った人は、残りに合わせて、素材の途中から鳴らす", () => {
		expect(countPlan(13_984, 4_500)).toEqual({
			kind: "once",
			offsetMs: 9484,
			delayMs: 0,
		});
	});

	it("素材より残りが長いときは、待ってから頭から鳴らす", () => {
		expect(countPlan(8_000, 10_000)).toEqual({
			kind: "once",
			offsetMs: 0,
			delayMs: 2000,
		});
	});

	it("短い素材（と、長さの分からない素材）: 残り 1 秒ごとに鳴らす", () => {
		expect(countPlan(300, 10_000)).toEqual({
			kind: "ticks",
			delaysMs: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000],
		});
		expect(countPlan(null, 2_500)).toEqual({
			kind: "ticks",
			delaysMs: [500, 1500],
		});
	});

	it("残りが無い、または数えられないときは鳴らさない", () => {
		expect(countPlan(13_984, 0)).toEqual({ kind: "none" });
		expect(countPlan(300, 0)).toEqual({ kind: "none" });
		expect(countPlan(13_984, Number.POSITIVE_INFINITY)).toEqual({
			kind: "none",
		});
	});
});

describe("ゲームの開始の音（start）", () => {
	it("カウントを見ていて、鬼選出から準備移動に移ったときだけ鳴らす", () => {
		const counting = { phase: "oni-selection", area: "counting" } as const;
		expect(startSignal(counting, "preparation")).toBe(true);
		expect(startSignal(counting, "oni-selection")).toBe(false);
		expect(startSignal(counting, "ended")).toBe(false);
	});

	it("カウントを見ていない（途中参加・再接続）ときは鳴らさない", () => {
		expect(
			startSignal({ phase: "oni-selection", area: "ready" }, "preparation"),
		).toBe(false);
		expect(startSignal(null, "preparation")).toBe(false);
		expect(
			startSignal({ phase: "preparation", area: null }, "preparation"),
		).toBe(false);
	});
});

describe("塗る音（paint）", () => {
	it("0.5 秒未満の素材は、0.1 秒ごとに鳴らす", () => {
		expect(PAINT_TICK_MS).toBe(100);
		expect(paintPlan(200)).toEqual({ kind: "ticks", intervalMs: 100 });
		expect(paintPlan(499)).toEqual({ kind: "ticks", intervalMs: 100 });
	});

	it("長い素材と、長さの分からない素材は、塗っている間だけ繰り返す", () => {
		expect(paintPlan(500)).toEqual({ kind: "loop", fadeMs: 150 });
		expect(paintPlan(7284)).toEqual({ kind: "loop", fadeMs: 150 });
		expect(paintPlan(null)).toEqual({ kind: "loop", fadeMs: 150 });
	});

	it("再生の速さは、±5% の範囲でばらつく（乱数は注入）", () => {
		expect(paintRate(() => 0)).toBeCloseTo(0.95);
		expect(paintRate(() => 0.5)).toBeCloseTo(1);
		expect(paintRate(() => 0.999999)).toBeCloseTo(1.05);
	});
});

describe("当たりと外れ（hit / miss）", () => {
	const before = ["a", "b"];

	it("窓は 0.5 秒（外れの理由の推定の結果の見方と同じ）", () => {
		expect(SHOT_RESULT_WINDOW_MS).toBe(500);
	});

	it("窓の中で、狙った人が隠れ中の一覧から消えたら、当たり", () => {
		const shot = openShot("a", before, 1000);
		expect(shotHit(shot, ["b"], 1300)).toBe(true);
		expect(shotHit(shot, ["a", "b"], 1300)).toBe(false);
	});

	it("窓を過ぎてから届いた当たりでは、鳴らさない（音は窓で確定）", () => {
		const shot = openShot("a", before, 1000);
		expect(shotHit(shot, ["b"], 1501)).toBe(false);
	});

	it("窓が当たりなく過ぎたら、外れ。窓の中は、まだ決めない", () => {
		const shot = openShot("a", before, 1000);
		expect(shotMissed(shot, 1499)).toBe(false);
		expect(shotMissed(shot, 1500)).toBe(true);
		expect(shotMissed(null, 5000)).toBe(false);
	});

	it("狙った人がいない射撃は、当たりにならない（窓のあとで外れ）", () => {
		const shot = openShot(null, before, 1000);
		expect(shotHit(shot, ["b"], 1100)).toBe(false);
		expect(shotMissed(shot, 1500)).toBe(true);
	});

	it("直前の一覧が無ければ、当たりと決めない", () => {
		const shot = openShot("a", null, 1000);
		expect(shotHit(shot, ["b"], 1100)).toBe(false);
	});

	it("窓が無ければ、当たりにならない", () => {
		expect(shotHit(null, ["b"], 1100)).toBe(false);
	});
});

describe("自分が見つかった（hit。見つかった本人）", () => {
	it("探索中に、一覧から自分が消えたら", () => {
		expect(foundSelf("exploration", ["me", "x"], ["x"], "me")).toBe(true);
	});

	it("自分が残っている、ほかの人が消えた、探索以外、直前が無い、自分が分からない: 鳴らさない", () => {
		expect(foundSelf("exploration", ["me", "x"], ["me"], "me")).toBe(false);
		expect(foundSelf("reveal", ["me"], [], "me")).toBe(false);
		expect(foundSelf("exploration", null, [], "me")).toBe(false);
		expect(foundSelf("exploration", ["x"], [], "me")).toBe(false);
		expect(foundSelf("exploration", ["me"], [], null)).toBe(false);
	});
});
