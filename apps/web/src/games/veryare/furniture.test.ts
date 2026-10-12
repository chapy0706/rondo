import { describe, expect, it } from "vitest";
import { FURNITURE_EXTRAS_KEY, parseFurniture } from "./furniture";

const valid = {
	[FURNITURE_EXTRAS_KEY]: {
		version: 1,
		boxes: [
			{ name: "タンス 和風 本体-001", min: [1, 0.6, 2], max: [2, 1.5, 2.4] },
			{ name: "冷蔵庫 操作軸-002", min: [-3, 0.6, 1], max: [-2.4, 2.41, 1.6] },
		],
	},
};

describe("parseFurniture - 家具の箱の一覧（家具の glb の scene の extras / issue-46 の続き）", () => {
	it("形が正しければ、名前と、最小・最大の角の一覧", () => {
		expect(parseFurniture(valid)).toEqual([
			{
				name: "タンス 和風 本体-001",
				min: { x: 1, y: 0.6, z: 2 },
				max: { x: 2, y: 1.5, z: 2.4 },
			},
			{
				name: "冷蔵庫 操作軸-002",
				min: { x: -3, y: 0.6, z: 1 },
				max: { x: -2.4, y: 2.41, z: 1.6 },
			},
		]);
	});

	it("箱が0個でもよい（家具の無いステージ）", () => {
		expect(
			parseFurniture({ [FURNITURE_EXTRAS_KEY]: { version: 1, boxes: [] } }),
		).toEqual([]);
	});

	it("形が違えば null（版が違う、角が3つの数でない、最小が最大より大きい、数でない、名前が無い）", () => {
		const box = { name: "a", min: [0, 0, 0], max: [1, 1, 1] };
		const wrap = (inner: unknown) => ({ [FURNITURE_EXTRAS_KEY]: inner });
		for (const bad of [
			null,
			{},
			wrap({ version: 2, boxes: [box] }),
			wrap({ version: 1, boxes: [{ ...box, min: [0, 0] }] }),
			wrap({ version: 1, boxes: [{ ...box, min: [2, 0, 0] }] }),
			wrap({ version: 1, boxes: [{ ...box, max: [1, "1", 1] }] }),
			wrap({ version: 1, boxes: [{ ...box, max: [1, Number.NaN, 1] }] }),
			wrap({ version: 1, boxes: [{ min: [0, 0, 0], max: [1, 1, 1] }] }),
			wrap({ version: 1, boxes: "x" }),
		]) {
			expect(parseFurniture(bad)).toBeNull();
		}
	});
});
