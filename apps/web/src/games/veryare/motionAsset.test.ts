import { describe, expect, it } from "vitest";
import {
	detrendRoot,
	horizontalRange,
	missingBones,
	seamAngle,
	strideOf,
	upAxisOf,
} from "./motionAsset";

type V3 = [number, number, number];

/** 前へ（向き heading、水平の軸 x・y の平面で）進みながら、左右に揺れ、上下する根の位置。 */
function walking(
	heading: number,
	frames = 31,
): { times: number[]; positions: V3[] } {
	const times: number[] = [];
	const positions: V3[] = [];
	for (let i = 0; i < frames; i++) {
		const t = i / 30;
		const progress = 162 * (i / (frames - 1));
		const sway = 2.4 * Math.sin((2 * Math.PI * i) / (frames - 1));
		const along = [Math.cos(heading), Math.sin(heading)];
		const side = [-Math.sin(heading), Math.cos(heading)];
		times.push(t);
		positions.push([
			(along[0] as number) * progress + (side[0] as number) * sway + 0.6,
			(along[1] as number) * progress + (side[1] as number) * sway + 1.3,
			-101.7 + 2 * Math.cos((4 * Math.PI * i) / (frames - 1)),
		]);
	}
	return { times, positions };
}

describe("detrendRoot - 根の、前へ進む分だけを直線で引く（issue-57）", () => {
	it("前へ進む分が消え、最初と最後の水平の位置がそろう。上下の動きは残る", () => {
		const { times, positions } = walking(Math.PI / 2);
		const out = detrendRoot(times, positions, [0, 1]);
		const first = out[0] as V3;
		const last = out[out.length - 1] as V3;
		expect(last[0]).toBeCloseTo(first[0], 9);
		expect(last[1]).toBeCloseTo(first[1], 9);
		expect(horizontalRange(out, [0, 1])).toBeLessThan(5);
		out.forEach((p, i) => expect(p[2]).toBe((positions[i] as V3)[2]));
	});

	it("左右の小さな揺れは残す（消さない）", () => {
		const { times, positions } = walking(Math.PI / 2);
		const out = detrendRoot(times, positions, [0, 1]);
		expect(horizontalRange(out, [0, 1])).toBeGreaterThan(4);
	});

	it("進む向きがどちらでも（体の向きを回しても）、同じように消える", () => {
		for (const heading of [0, 0.5, Math.PI / 2, 2.4, -1.1]) {
			const { times, positions } = walking(heading);
			const out = detrendRoot(times, positions, [0, 1]);
			// 最初の位置からの水平の距離（向きに依らない量）が、向きを回しても同じ。
			const reference = detrendRoot(
				times,
				walking(Math.PI / 2).positions,
				[0, 1],
			);
			const distances = (list: [number, number, number][]) =>
				list.map((p) => {
					const o = list[0] as [number, number, number];
					return Math.hypot(p[0] - o[0], p[1] - o[1]);
				});
			const expected = distances(reference);
			distances(out).forEach((d, i) =>
				expect(d).toBeCloseTo(expected[i] ?? Number.NaN, 6),
			);
			const first = out[0] as V3;
			const last = out[out.length - 1] as V3;
			expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeLessThan(
				1e-9,
			);
		}
	});

	it("引く軸は、水平の2軸だけ（上下の軸は引かない）", () => {
		const times = [0, 1];
		const positions: V3[] = [
			[0, 0, 0],
			[10, 20, 30],
		];
		expect(detrendRoot(times, positions, [0, 1])).toEqual([
			[0, 0, 0],
			[0, 0, 30],
		]);
		expect(detrendRoot(times, positions, [0, 2])).toEqual([
			[0, 0, 0],
			[0, 20, 0],
		]);
	});
});

describe("strideOf・upAxisOf・missingBones・seamAngle - 素材の検査の計算", () => {
	it("歩幅は、最初から最後までの水平の距離", () => {
		const { positions } = walking(0.7);
		expect(strideOf(positions, [0, 1])).toBeCloseTo(162, 6);
	});

	it("上下の軸は、親の行列で、場面の上（y）に向くノードの軸（列の順の 4×4）", () => {
		// x 軸まわりに +90°（ノードの z が場面の y）、大きさ 0.01。
		const parent = [0.01, 0, 0, 0, 0, 0, 0.01, 0, 0, -0.01, 0, 0, 0, 0, 0, 1];
		expect(upAxisOf(parent)).toBe(2);
		const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		expect(upAxisOf(identity)).toBe(1);
	});

	it("体に無い骨の名前を返す", () => {
		expect(missingBones(["a", "b", "c"], ["a", "c", "d"])).toEqual(["b"]);
		expect(missingBones(["a"], ["a", "b"])).toEqual([]);
	});

	it("最初と最後の姿勢の差（回転の角度の最大。度）", () => {
		const q = [0, 0, 0, 1];
		const turned = [
			0,
			Math.sin(0.5 * (Math.PI / 180)),
			0,
			Math.cos(0.5 * (Math.PI / 180)),
		];
		expect(seamAngle([q, q], [q, q])).toBeCloseTo(0, 9);
		expect(seamAngle([q, q], [q, turned])).toBeCloseTo(1, 6);
		// 符号が逆の四元数は、同じ回転。
		expect(seamAngle([q], [[0, 0, 0, -1]])).toBeCloseTo(0, 9);
	});
});
