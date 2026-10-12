import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { edgeKey, parseStageNotice } from "./stage";
import { stageBoxes } from "./stageBoxes";
import { entranceDoorEdges, uncoveredEdges } from "./stageEnclosure";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");

/** 玄関（@）が地図の南端に接する小さな間取り。幅 w の玄関。 */
const genkan = (w: number) => {
	const grid = parseStageNotice({
		type: "stage",
		cellSize: 1,
		origin: { x: 0, z: 0 },
		width: w + 2,
		depth: 2,
		rows: [".".repeat(w + 2), `#${"@".repeat(w)}#`],
		regions: { ".": "open", "@": "open" },
		rooms: {},
		doors: [],
		spawn: { x: 0.5, z: 0.5 },
	});
	if (grid === null) throw new Error("読めない");
	return grid;
};

describe("uncoveredEdges - 歩けるマスの辺に、見えない境が残っていないか", () => {
	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: 歩けるマスのすべての辺が、壁・戸・別の歩ける場所のどれか（襖は開けても閉めても）",
		(_id, notice) => {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			const fusumas = stage.doorList
				.filter((d) => d.kind === "fusuma")
				.map((d) => edgeKey(d.a, d.b));
			for (const open of [new Set<string>(), new Set(fusumas)]) {
				expect(uncoveredEdges(stage, stageBoxes(stage, open))).toEqual([]);
			}
		},
	);

	it("小さな見本でも、地図の東端・南端を含めて、見えない境が無い", () => {
		expect(uncoveredEdges(tiny, stageBoxes(tiny, new Set()))).toEqual([]);
	});

	it("壁を抜くと、その辺を見つける（確かめ方が働いている）", () => {
		const boxes = stageBoxes(tiny, new Set()).filter(
			(b) => !(b.kind === "wall" && b.x === 5 && b.z === 2.5),
		);
		expect(uncoveredEdges(tiny, boxes)).toEqual([
			{ a: { x: 4, z: 2 }, b: { x: 5, z: 2 } },
		]);
	});
});

describe("entranceDoorEdges - 玄関の外へ出る辺（地図の端に面した辺）の、中央のマスに引き戸", () => {
	it("幅が奇数なら中央の 1 マス、偶数なら中央の 2 マス", () => {
		expect([...entranceDoorEdges(genkan(5))]).toEqual(["3,1|3,2"]);
		expect([...entranceDoorEdges(genkan(4))].sort()).toEqual([
			"2,1|2,2",
			"3,1|3,2",
		]);
		expect([...entranceDoorEdges(genkan(1))]).toEqual(["1,1|1,2"]);
	});

	it("玄関が無い・地図の端に面していなければ、引き戸は無い", () => {
		expect(entranceDoorEdges(tiny).size).toBe(0);
	});

	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: 玄関の南の辺の中央に、引き戸が 1 つ",
		(_id, notice) => {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			expect(entranceDoorEdges(stage).size).toBe(1);
		},
	);
});
