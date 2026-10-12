import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import {
	DUMMY_FUSUMA_MAX,
	DUMMY_FUSUMA_MIN,
	dummyFusumaEdges,
	mapSeed,
} from "./dummyFusuma";
import { type Cell, edgeKey, parseStageNotice } from "./stage";
import { stageBoxes } from "./stageBoxes";
import { uncoveredEdges } from "./stageEnclosure";

const cellsOf = (key: string): [Cell, Cell] => {
	const [a, b] = key.split("|").map((part) => {
		const [x, z] = part.split(",").map(Number);
		return { x: x ?? 0, z: z ?? 0 };
	}) as [Cell, Cell];
	return [a, b];
};

/** 同じ直線上で隣り合う2辺か（端を1つ共有する）。 */
const collinearNeighbors = (p: string, q: string) => {
	const [a1, b1] = cellsOf(p);
	const [a2, b2] = cellsOf(q);
	const vertical = (a: Cell, b: Cell) => a.x === b.x;
	if (vertical(a1, b1) !== vertical(a2, b2)) return false;
	return vertical(a1, b1)
		? a1.z === a2.z && Math.abs(a1.x - a2.x) === 1
		: a1.x === a2.x && Math.abs(a1.z - a2.z) === 1;
};

const stages = skeletons.stages.map((notice, i) => {
	const stage = parseStageNotice(notice);
	if (stage === null) throw new Error("読めない");
	return [i + 1, stage] as const;
});

describe("dummyFusumaEdges - ダミーの襖の位置（地図の中身から決まる）", () => {
	it("同じ地図なら、同じ位置（別に読み直しても、全員の画面で同じ）", () => {
		for (const notice of skeletons.stages) {
			const a = parseStageNotice(notice);
			const b = parseStageNotice(JSON.parse(JSON.stringify(notice)));
			if (a === null || b === null) throw new Error("読めない");
			expect([...dummyFusumaEdges(a)]).toEqual([...dummyFusumaEdges(b)]);
		}
	});

	it("乱数の種は、行の文字列から決まる（行が違えば、種も違う）", () => {
		const [, first] = stages[0] ?? [];
		const [, second] = stages[1] ?? [];
		if (first === undefined || second === undefined) throw new Error("無い");
		expect(mapSeed(first)).toBe(mapSeed(first));
		expect(mapSeed(first)).not.toBe(mapSeed(second));
	});

	it.each(stages)(
		"骨格%i: 個数は範囲内。2 つの歩ける場所の間の壁にあり、本物の襖とその両隣・玄関・縁側・ほかのダミーの隣を避ける",
		(_id, stage) => {
			const edges = [...dummyFusumaEdges(stage)];
			expect(edges.length).toBeGreaterThanOrEqual(DUMMY_FUSUMA_MIN);
			expect(edges.length).toBeLessThanOrEqual(DUMMY_FUSUMA_MAX);
			const real = stage.doorList.map((d) => edgeKey(d.a, d.b));
			for (const key of edges) {
				const [a, b] = cellsOf(key);
				const ra = stage.regionAt(a);
				const rb = stage.regionAt(b);
				expect(ra).not.toBeNull();
				expect(rb).not.toBeNull();
				expect(ra).not.toBe(rb);
				expect(stage.doors.has(key)).toBe(false);
				for (const door of real) {
					expect(collinearNeighbors(key, door), `${key} と ${door}`).toBe(
						false,
					);
				}
				for (const cell of [a, b]) {
					expect(["@", "="]).not.toContain(stage.charAt(cell));
				}
				for (const other of edges) {
					if (other !== key) expect(collinearNeighbors(key, other)).toBe(false);
				}
			}
		},
	);

	it("平屋のステージには、足さない", () => {
		const stage = parseStageNotice(hirayaFixture.stage);
		if (stage === null) throw new Error("読めない");
		expect(dummyFusumaEdges(stage).size).toBe(0);
	});
});

describe("stageBoxes - ダミーの襖と引き手", () => {
	it.each(stages)(
		"骨格%i: ダミーの位置は、壁の代わりに、本物の閉じた襖と同じ板・鴨居・柱。引き手は付けない。見えない境は無い",
		(_id, stage) => {
			const boxes = stageBoxes(stage, new Set());
			const dummies = boxes.filter((b) => b.kind === "dummy-fusuma");
			expect(dummies).toHaveLength(dummyFusumaEdges(stage).size);
			const real = boxes.filter((b) => b.kind === "fusuma");
			for (const dummy of dummies) {
				const twin = real[0];
				if (twin === undefined) throw new Error("本物の襖が無い");
				expect(dummy.color).toBe(twin.color);
				expect(dummy.material).toBe(twin.material);
				expect(dummy.height).toBe(twin.height);
				expect(Math.min(dummy.width, dummy.depth)).toBe(
					Math.min(twin.width, twin.depth),
				);
				// 同じ辺に、壁は無く、鴨居（枠）がある。
				const here = boxes.filter((b) => b.x === dummy.x && b.z === dummy.z);
				expect(here.map((b) => b.kind).sort()).toEqual([
					"dummy-fusuma",
					"frame",
				]);
				// 引き手は、ダミーの板の近くには無い。
				const near = boxes.filter(
					(b) =>
						b.kind === "hikite" &&
						Math.abs(b.x - dummy.x) < 0.5 &&
						Math.abs(b.z - dummy.z) < 0.5,
				);
				expect(near).toHaveLength(0);
			}
			expect(uncoveredEdges(stage, boxes)).toEqual([]);
		},
	);

	it.each(stages)(
		"骨格%i: 本物の閉じた襖には、引き手が1つ（小さく、暗い色）。開いた襖には無い",
		(_id, stage) => {
			const closed = stageBoxes(stage, new Set());
			const panels = closed.filter((b) => b.kind === "fusuma");
			const handles = closed.filter((b) => b.kind === "hikite");
			expect(handles).toHaveLength(panels.length);
			for (const handle of handles) {
				expect(Math.max(handle.width, handle.depth)).toBeLessThan(0.1);
				expect(handle.height).toBeLessThan(0.15);
				expect(handle.multiply).not.toBeNull();
				const panel = panels.find(
					(p) =>
						Math.abs(p.x - handle.x) < 0.5 && Math.abs(p.z - handle.z) < 0.5,
				);
				expect(panel).toBeDefined();
			}
			const allOpen = new Set(
				stage.doorList
					.filter((d) => d.kind === "fusuma")
					.map((d) => edgeKey(d.a, d.b)),
			);
			const opened = stageBoxes(stage, allOpen);
			expect(opened.filter((b) => b.kind === "hikite")).toHaveLength(0);
			// ダミーは開けられない（開いた鍵の集合に関係なく、板が残る）。
			expect(opened.filter((b) => b.kind === "dummy-fusuma")).toHaveLength(
				dummyFusumaEdges(stage).size,
			);
		},
	);
});
