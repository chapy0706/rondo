import { describe, expect, it } from "vitest";
import { type TrackSample, pushSample, sampleTrack, trackDelay } from "./track";

const s = (at: number, x: number, z = 0, facing = 0): TrackSample => ({
	at,
	x,
	z,
	facing,
});

/** 置き直しの間（gapMs）と、置き直す位置（新しい通知の reseatMs 前）。 */
const reseat = { gapMs: 300, reseatMs: 150 };

describe("pushSample - 届いた通知を、時刻つきで2〜3個持つ（鬼とメンバーで共通 / issue-59）", () => {
	it("足していき、3個を超えたら古いものから捨てる", () => {
		const track = [s(0, 0), s(100, 1), s(200, 2), s(300, 3)].reduce<
			readonly TrackSample[]
		>((t, sample) => pushSample(t, sample, reseat), []);
		expect(track.map((p) => p.x)).toEqual([1, 2, 3]);
	});

	it("間が gapMs を超えて空いた（止まっていた）ときは、前の位置を、新しい通知の reseatMs 前に置き直す", () => {
		const track = pushSample([s(0, 1)], s(5000, 4), reseat);
		expect(track).toEqual([s(4850, 1), s(5000, 4)]);
	});

	it("間が gapMs ちょうどなら、置き直さない", () => {
		expect(pushSample([s(0, 1)], s(300, 2), reseat)).toEqual([
			s(0, 1),
			s(300, 2),
		]);
	});

	it("時刻が戻った通知は、前の通知の直後として扱う", () => {
		const track = pushSample([s(100, 1)], s(50, 2), reseat);
		expect(track.map((p) => p.at)).toEqual([100, 101]);
	});
});

describe("trackDelay - 遅らせる時間（届いた間隔の平均。下限・上限で切る）", () => {
	const limits = { minDelayMs: 100, maxDelayMs: 600 };

	it("届いた間隔の平均を、下限・上限で切る", () => {
		expect(trackDelay([s(0, 0), s(250, 1), s(500, 2)], limits)).toBe(250);
		expect(trackDelay([s(0, 0), s(20, 1)], limits)).toBe(100);
		expect(trackDelay([s(0, 0), s(2000, 1)], limits)).toBe(600);
	});

	it("通知が1つ以下なら下限", () => {
		expect(trackDelay([], limits)).toBe(100);
		expect(trackDelay([s(0, 0)], limits)).toBe(100);
	});
});

describe("sampleTrack - 時刻の位置を、前後2つの通知から直線で補間する", () => {
	it("前後の間は直線で補間し、最新より先は最新、最古より前は最古", () => {
		const track = [s(0, 0, 0), s(100, 1, 2)];
		expect(sampleTrack(track, 50)).toEqual({ x: 0.5, z: 1, facing: 0 });
		expect(sampleTrack(track, 500)).toEqual({ x: 1, z: 2, facing: 0 });
		expect(sampleTrack(track, -10)).toEqual({ x: 0, z: 0, facing: 0 });
	});

	it("向きは、近い回り方で補間する", () => {
		const track = [s(0, 0, 0, Math.PI - 0.1), s(100, 0, 0, -Math.PI + 0.1)];
		const mid = sampleTrack(track, 50);
		expect(Math.abs(Math.abs(mid?.facing ?? 0) - Math.PI)).toBeLessThan(1e-9);
	});

	it("通知が無ければ null", () => {
		expect(sampleTrack([], 0)).toBeNull();
	});
});
