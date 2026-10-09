import { describe, expect, it } from "vitest";
import movement from "../../packages/contracts/src/fixtures/veryare-movement.json";
import stageFixture from "../../packages/contracts/src/fixtures/veryare-stage.json";
import { readStageNotice, spreadSpots } from "./stage.ts";

/** 共有の見本の小さな屋敷（玄関は (0.5, 4.5)）。 */
const tiny = stageFixture.valid[0];

describe("readStageNotice - ステージの通知を読む（issue-29a）", () => {
	it("共有の見本の valid を読める", () => {
		for (const sample of stageFixture.valid) {
			expect(readStageNotice(sample)).not.toBeNull();
		}
	});

	it("共有の見本の invalid は読まない", () => {
		for (const sample of stageFixture.invalid) {
			expect(readStageNotice(sample)).toBeNull();
		}
	});

	it("移動の見本の地図と同じ地図を読む", () => {
		expect(readStageNotice(movement.stage)).toEqual(readStageNotice(tiny));
	});
});

describe("spreadSpots - 玄関から一直線にたどれる、別々の場所（issue-29a）", () => {
	const stage = readStageNotice(tiny);
	if (stage === null) throw new Error("見本が読めない");

	it("近い順（1マス目を上・右・左・下、2マス目を…）に、同じ領域のまま一直線に着ける場所を返す", () => {
		expect(spreadSpots(stage, 5, 7)).toEqual([
			{ x: 0.5, z: 3.5 },
			{ x: 1.5, z: 4.5 },
			{ x: 0.5, z: 2.5 },
			{ x: 0.5, z: 1.5 },
			{ x: 0.5, z: 0.5 },
		]);
	});

	it("数と距離の上限を守る", () => {
		expect(spreadSpots(stage, 2, 7)).toHaveLength(2);
		const near = spreadSpots(stage, 5, 1.5);
		expect(near).toEqual([
			{ x: 0.5, z: 3.5 },
			{ x: 1.5, z: 4.5 },
		]);
	});

	it("どの2つも、玄関とも互いとも 0.8 m 以上離れている（被り判定の直径 0.6 m より余裕がある）", () => {
		const spots = spreadSpots(stage, 5, 7);
		const points = [stage.spawn, ...spots];
		for (let i = 0; i < points.length; i++) {
			for (let j = i + 1; j < points.length; j++) {
				const a = points[i] as { x: number; z: number };
				const b = points[j] as { x: number; z: number };
				expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.8);
			}
		}
	});
});
