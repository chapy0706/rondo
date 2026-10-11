import { describe, expect, it } from "vitest";
import {
	ONI_TRACK_MAX_DELAY_MS,
	ONI_TRACK_MIN_DELAY_MS,
	type OniSample,
	pushOniSample,
	sampleOni,
	trackDelay,
} from "./oniTrack";

const s = (at: number, x: number, z = 0, facing = 0): OniSample => ({
	at,
	x,
	z,
	facing,
});

describe("pushOniSample - 届いた鬼の通知を、時刻つきで2〜3個持つ（issue-46）", () => {
	it("新しい順に足し、3個を超えたら古いものから捨てる", () => {
		let track: readonly OniSample[] = [];
		for (const at of [0, 50, 100, 150]) track = pushOniSample(track, s(at, at));
		expect(track.map((p) => p.at)).toEqual([50, 100, 150]);
	});

	it("間が大きく空いた（止まっていた）ときは、前の位置を、新しい通知の少し前に置き直す", () => {
		const track = pushOniSample([s(0, 1), s(50, 2)], s(5_000, 3));
		expect(track).toEqual([s(5_000 - ONI_TRACK_MIN_DELAY_MS, 2), s(5_000, 3)]);
	});

	it("時刻が戻った通知は、前の通知の直後として扱う（補間の順を壊さない）", () => {
		const track = pushOniSample([s(100, 1)], s(90, 2));
		expect(track.map((p) => p.at)).toEqual([100, 101]);
	});
});

describe("trackDelay - 遅らせる時間（届いた間隔の実測。下限 100 ms・上限 600 ms）", () => {
	it("人間の鬼（約 50 ms ごと）は 100 ms、鬼 CPU（0.5 秒ごと）は 500 ms", () => {
		expect(ONI_TRACK_MIN_DELAY_MS).toBe(100);
		expect(ONI_TRACK_MAX_DELAY_MS).toBe(600);
		expect(trackDelay([s(0, 0), s(50, 1), s(100, 2)])).toBe(100);
		expect(trackDelay([s(0, 0), s(500, 1), s(1_000, 2)])).toBe(500);
	});

	it("間隔が長くても 600 ms まで。通知が1つ以下なら 100 ms", () => {
		expect(trackDelay([s(0, 0), s(900, 1)])).toBe(600);
		expect(trackDelay([s(0, 0)])).toBe(100);
		expect(trackDelay([])).toBe(100);
	});
});

describe("sampleOni - 遅らせた時刻の位置を、前後2つの通知から直線で補間する", () => {
	const track = [s(0, 0, 0, 0), s(100, 1, 2, 0), s(200, 3, 2, 0)];

	it("前後2つの通知の間は、直線で補間する", () => {
		expect(sampleOni(track, 50)).toEqual({ x: 0.5, z: 1, facing: 0 });
		expect(sampleOni(track, 150)).toEqual({ x: 2, z: 2, facing: 0 });
	});

	it("最新より先は延ばさず、最新の位置で止める。最古より前は最古の位置", () => {
		expect(sampleOni(track, 1_000)).toEqual({ x: 3, z: 2, facing: 0 });
		expect(sampleOni(track, -50)).toEqual({ x: 0, z: 0, facing: 0 });
	});

	it("向きは、近い回り方で補間する（179° と -179° の間は、0° を通らない）", () => {
		const deg = Math.PI / 180;
		const turn = [s(0, 0, 0, 179 * deg), s(100, 0, 0, -179 * deg)];
		const mid = sampleOni(turn, 50)?.facing ?? 0;
		expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
	});

	it("通知が無ければ null", () => {
		expect(sampleOni([], 0)).toBeNull();
	});
});
