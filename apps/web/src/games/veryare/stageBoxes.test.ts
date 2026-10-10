import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { FLOOR_COLOR, ROOM_COLORS } from "./palette";
import { edgeKey, parseStageNotice } from "./stage";
import {
	FLOOR_THICKNESS,
	FUSUMA_COLOR,
	type StageBox,
	WALL_COLOR,
	WALL_HEIGHT,
	WALL_THICKNESS,
	stageBoxes,
} from "./stageBoxes";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");
const none = new Set<string>();

const of = (boxes: readonly StageBox[], kind: StageBox["kind"]) =>
	boxes.filter((box) => box.kind === kind);

/** 境 x = const（縦の境）または z = const（横の境）の中央にある箱。 */
const onEdge = (boxes: readonly StageBox[], x: number, z: number) =>
	boxes.filter((box) => box.kind !== "floor" && box.x === x && box.z === z);

describe("stageBoxes - 床の箱（issue-29c）", () => {
	const boxes = stageBoxes(tiny, none);
	const floors = of(boxes, "floor");

	it("歩けるマスごとに1つ。上面が高さ 0 で、マスの大きさ", () => {
		expect(floors).toHaveLength(16);
		const first = floors.find((box) => box.x === 0.5 && box.z === 0.5);
		expect(first).toEqual({
			kind: "floor",
			x: 0.5,
			y: -FLOOR_THICKNESS / 2,
			z: 0.5,
			width: 1,
			height: FLOOR_THICKNESS,
			depth: 1,
			color: FLOOR_COLOR,
		});
		// 歩けないマス（# と、割り当てのないスロット）には床を敷かない。
		expect(floors.some((box) => box.x === 3.5 && box.z === 0.5)).toBe(false);
	});

	it("床の色は、その場の代表色（部屋タイプの色・廊下の色）", () => {
		const color = (x: number, z: number) =>
			floors.find((box) => box.x === x && box.z === z)?.color;
		expect(color(2.5, 0.5)).toBe(ROOM_COLORS.washitsu);
		expect(color(2.5, 3.5)).toBe(ROOM_COLORS.oshiire);
		expect(color(4.5, 2.5)).toBe(FLOOR_COLOR);
	});

	it("原点とマスの大きさに合わせる", () => {
		const moved = parseStageNotice({
			...movement.stage,
			cellSize: 2,
			origin: { x: -3, z: 1 },
		});
		if (moved === null) throw new Error("読めない");
		const box = of(stageBoxes(moved, none), "floor")[0];
		expect(box).toMatchObject({ x: -2, z: 2, width: 2, depth: 2 });
	});
});

describe("stageBoxes - 壁の箱（高さ 2.4 m、厚さ 0.1 m）", () => {
	const boxes = stageBoxes(tiny, none);

	it("違う領域どうしの境（戸の一覧に無い）は壁。境の線の中央に立つ", () => {
		// (1,0) と (2,0)（廊下と部屋 A）の境は x = 2。
		expect(onEdge(boxes, 2, 0.5)).toEqual([
			{
				kind: "wall",
				x: 2,
				y: WALL_HEIGHT / 2,
				z: 0.5,
				width: WALL_THICKNESS,
				height: WALL_HEIGHT,
				depth: 1,
				color: WALL_COLOR,
			},
		]);
		expect(WALL_HEIGHT).toBe(2.4);
		expect(WALL_THICKNESS).toBe(0.1);
	});

	it("歩けるマスと、歩けないマス・地図の外との境も壁", () => {
		// 部屋 A (2,0) と # (3,0) の境は x = 3。地図の外（x = 0 の西、z = 0 の北）も壁。
		expect(of(onEdge(boxes, 3, 0.5), "wall")).toHaveLength(1);
		expect(of(onEdge(boxes, 0, 0.5), "wall")).toHaveLength(1);
		const north = onEdge(boxes, 0.5, 0)[0];
		expect(north).toMatchObject({
			kind: "wall",
			width: 1,
			depth: WALL_THICKNESS,
		});
	});

	it("同じ領域どうしの境、歩けないマスどうしの境には、何も立てない", () => {
		expect(onEdge(boxes, 1, 0.5)).toEqual([]);
		expect(onEdge(boxes, 4, 0.5)).toEqual([]);
	});
});

describe("stageBoxes - 戸の箱", () => {
	it("閉じた襖は、壁と違う色の板と枠。開いたら板だけ隠す", () => {
		const closed = onEdge(stageBoxes(tiny, none), 2, 1.5);
		expect(of(closed, "fusuma")).toHaveLength(1);
		expect(of(closed, "fusuma")[0]?.color).toBe(FUSUMA_COLOR);
		expect(FUSUMA_COLOR).not.toBe(WALL_COLOR);
		expect(of(closed, "frame").length).toBeGreaterThan(0);
		expect(of(closed, "wall")).toEqual([]);

		const open = onEdge(
			stageBoxes(tiny, new Set([edgeKey({ x: 1, z: 1 }, { x: 2, z: 1 })])),
			2,
			1.5,
		);
		expect(of(open, "fusuma")).toEqual([]);
		expect(of(open, "frame").length).toBe(of(closed, "frame").length);
		// 開けていない別の襖は、閉じたまま。
		expect(
			of(
				onEdge(
					stageBoxes(tiny, new Set([edgeKey({ x: 1, z: 1 }, { x: 2, z: 1 })])),
					3,
					2.5,
				),
				"fusuma",
			),
		).toHaveLength(1);
	});

	it("いつも閉じている戸は、壁と同じ色の板。いつも開いている戸は何も描かない", () => {
		// 見本の (2,4) は歩けないマスなので、部屋 B を広げて、両側が歩ける戸にする。
		const rows = ["..A##", "..A##", "..A..", "..B##", "..B##"];
		const wide = parseStageNotice({ ...movement.stage, rows });
		if (wide === null) throw new Error("読めない");
		const boxes = stageBoxes(wide, none);
		const fixed = onEdge(boxes, 2, 4.5);
		expect(fixed).toHaveLength(1);
		expect(fixed[0]).toMatchObject({
			kind: "fixed-door",
			color: WALL_COLOR,
			height: WALL_HEIGHT,
		});
		expect(onEdge(boxes, 2, 3.5)).toEqual([]);
	});
});

describe("stageBoxes - 10種の骨格", () => {
	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: 床は歩けるマスの数だけ、箱の数は描画が軽い範囲（3000 以下）",
		(_id, notice) => {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			const boxes = stageBoxes(stage, none);
			let walkable = 0;
			for (let z = 0; z < stage.depth; z++) {
				for (let x = 0; x < stage.width; x++) {
					if (stage.regionAt({ x, z }) !== null) walkable++;
				}
			}
			expect(of(boxes, "floor")).toHaveLength(walkable);
			expect(boxes.length).toBeLessThanOrEqual(3000);
		},
	);

	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: 壁は違う領域どうしの境にだけあり、戸のある境には無い。襖の板は閉じた襖にだけある",
		(_id, notice) => {
			const stage = parseStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			// 見本の骨格はマスの大きさ 1、原点 (0, 0)。箱の中心から境の2マスを戻す。
			expect(stage.cellSize).toBe(1);
			expect(stage.origin).toEqual({ x: 0, z: 0 });
			const edgeOf = (box: StageBox) =>
				box.width < box.depth
					? [
							{ x: box.x - 1, z: Math.floor(box.z) },
							{ x: box.x, z: Math.floor(box.z) },
						]
					: [
							{ x: Math.floor(box.x), z: box.z - 1 },
							{ x: Math.floor(box.x), z: box.z },
						];
			const fusumas = stage.doorList.filter(
				(d) =>
					d.kind === "fusuma" &&
					stage.regionAt(d.a) !== null &&
					stage.regionAt(d.b) !== null,
			);
			const allOpen = new Set(fusumas.map((d) => edgeKey(d.a, d.b)));

			const closed = stageBoxes(stage, none);
			for (const wall of of(closed, "wall")) {
				const [a, b] = edgeOf(wall) as [
					{ x: number; z: number },
					{ x: number; z: number },
				];
				expect(stage.regionAt(a)).not.toBe(stage.regionAt(b));
				const onDoor =
					stage.regionAt(a) !== null &&
					stage.regionAt(b) !== null &&
					stage.doors.has(edgeKey(a, b));
				expect(onDoor).toBe(false);
			}
			const panels = of(closed, "fusuma").map((box) => {
				const [a, b] = edgeOf(box) as [
					{ x: number; z: number },
					{ x: number; z: number },
				];
				return edgeKey(a, b);
			});
			expect(new Set(panels)).toEqual(allOpen);
			expect(of(stageBoxes(stage, allOpen), "fusuma")).toEqual([]);
		},
	);
});
