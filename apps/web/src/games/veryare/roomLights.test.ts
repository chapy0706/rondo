import { describe, expect, it } from "vitest";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { ROOM_LIGHT_COUNT, nearestSpots, roomLightSpots } from "./roomLights";
import { parseStageNotice } from "./stage";

describe("部屋の灯り（数を抑える）", () => {
	it("灯りの位置は、部屋（rooms にある領域）ごとに1つ、その部屋のマスの中心", () => {
		const stage = parseStageNotice({
			type: "stage",
			cellSize: 1,
			origin: { x: 0, z: 0 },
			width: 4,
			depth: 2,
			rows: ["AA..", "AA.B"],
			regions: { ".": "open", A: "A", B: "B" },
			rooms: { A: "washitsu", B: "oshiire" },
			doors: [],
			spawn: { x: 2.5, z: 0.5 },
		});
		if (stage === null) throw new Error("読めない");
		const spots = roomLightSpots(stage);
		expect(spots).toEqual([
			{ x: 1, z: 1 },
			{ x: 3.5, z: 1.5 },
		]);
	});

	it("近い順に、最大 n 個（同じ距離なら、先に出てきた順）", () => {
		const spots = [
			{ x: 10, z: 0 },
			{ x: 1, z: 0 },
			{ x: 5, z: 0 },
			{ x: -1, z: 0 },
		];
		expect(nearestSpots(spots, { x: 0, z: 0 }, 2)).toEqual([
			{ x: 1, z: 0 },
			{ x: -1, z: 0 },
		]);
		expect(nearestSpots(spots, { x: 0, z: 0 }, 9)).toHaveLength(4);
		expect(nearestSpots([], { x: 0, z: 0 }, 4)).toEqual([]);
	});

	it("灯りの数は一定（4）。10 種の骨格の部屋の数より少ない", () => {
		expect(ROOM_LIGHT_COUNT).toBe(4);
		for (const notice of skeletons.stages) {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			expect(roomLightSpots(stage).length).toBeGreaterThan(ROOM_LIGHT_COUNT);
		}
	});
});
