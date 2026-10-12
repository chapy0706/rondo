import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { FLOOR_COLOR, ROOM_COLORS } from "./palette";
import { edgeKey, parseStageNotice } from "./stage";
import {
	CEILING_COLOR,
	FLOOR_THICKNESS,
	FRAME_COLOR,
	FUSUMA_COLOR,
	FUSUMA_HEIGHT,
	type StageBox,
	WALL_COLOR,
	WALL_HEIGHT,
	WALL_THICKNESS,
	stageBoxes,
} from "./stageBoxes";
import { CEILING_MULTIPLY, WALL_MULTIPLY } from "./stageMaterials";

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
		expect(first).toMatchObject({
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
		expect(onEdge(boxes, 2, 0.5)).toMatchObject([
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

describe("stageBoxes - 材質の鍵（平屋の材質で飾る / stageMaterials.ts）", () => {
	const boxes = stageBoxes(tiny, none);
	const floorAt = (x: number, z: number) =>
		of(boxes, "floor").find(
			(b) =>
				Math.abs(b.x - (x + 0.5)) < 1e-9 && Math.abs(b.z - (z + 0.5)) < 1e-9,
		);

	it("床は、場所の材質と、寄せる色（その場の代表色。いまの色と同じ）。畳は部屋の隅が絵の原点", () => {
		const washitsu = floorAt(2, 0);
		expect(washitsu?.material).toBe("tatami");
		expect(washitsu?.tint).toBe(ROOM_COLORS.washitsu);
		expect(washitsu?.tint).toBe(washitsu?.color);
		expect(washitsu?.uvOrigin).toEqual({ x: 2, z: 0 });
		const oshiire = floorAt(2, 3);
		expect(oshiire?.material).toBe("wood-dark");
		expect(oshiire?.tint).toBe(ROOM_COLORS.oshiire);
		const corridor = floorAt(0, 0);
		expect(corridor?.material).toBe("wood-board");
		expect(corridor?.tint).toBe(FLOOR_COLOR);
		expect(corridor?.uvOrigin).toEqual({ x: 0, z: 0 });
	});

	it("壁は木の板張り（濃い木目に WALL_MULTIPLY を掛ける）。襖の板は襖、鴨居・柱は濃い木目（寄せず、掛けない）", () => {
		for (const wall of of(boxes, "wall")) {
			expect(wall.material).toBe("wood-dark");
			expect(wall.tint).toBeNull();
			expect(wall.multiply).toBe(WALL_MULTIPLY);
		}
		for (const panel of of(boxes, "fusuma")) {
			expect(panel.material).toBe("fusuma");
			expect(panel.tint).toBeNull();
			expect(panel.multiply).toBeNull();
		}
		for (const frame of of(boxes, "frame")) {
			expect(frame.material).toBe("wood-dark");
			expect(frame.tint).toBeNull();
			expect(frame.multiply).toBeNull();
		}
		// 床は、代表色に寄せる（掛ける色は無い）。
		for (const floor of of(boxes, "floor")) expect(floor.multiply).toBeNull();
	});

	it("色（素材が無いときに使う）は、これまでどおり", () => {
		for (const wall of of(boxes, "wall")) expect(wall.color).toBe(WALL_COLOR);
		for (const panel of of(boxes, "fusuma"))
			expect(panel.color).toBe(FUSUMA_COLOR);
		for (const frame of of(boxes, "frame"))
			expect(frame.color).toBe(FRAME_COLOR);
	});
});

describe("stageBoxes - 囲む（地図の端の壁、天井、玄関の引き戸）", () => {
	const boxes = stageBoxes(tiny, none);

	it("地図の東端・南端の辺にも、壁が立つ", () => {
		// (4,2) の東は地図の外（x = 5）。(0,4) の南も地図の外（z = 5）。
		expect(onEdge(boxes, 5, 2.5).map((b) => b.kind)).toEqual(["wall"]);
		expect(onEdge(boxes, 0.5, 5).map((b) => b.kind)).toEqual(["wall"]);
	});

	it("天井は、歩けるマスごとに1つ。下面が壁と同じ高さ 2.4 m。木の板（wood-board）を CEILING_MULTIPLY で暗くする", () => {
		const ceilings = of(boxes, "ceiling");
		expect(ceilings).toHaveLength(of(boxes, "floor").length);
		for (const c of ceilings) {
			expect(c.y - c.height / 2).toBeCloseTo(WALL_HEIGHT, 9);
			expect(c.width).toBe(1);
			expect(c.depth).toBe(1);
			expect(c.material).toBe("wood-board");
			expect(c.tint).toBeNull();
			expect(c.multiply).toBe(CEILING_MULTIPLY);
			expect(c.color).toBe(CEILING_COLOR);
		}
	});

	it("玄関の外へ出る辺の中央のマスは、引き戸（壁と同じ材質の板）と枠。ほかの辺は壁", () => {
		const stage = parseStageNotice(skeletons.stages[0]);
		if (stage === null) throw new Error("読めない");
		const list = stageBoxes(stage, none);
		// 骨格1の玄関は x 5〜9、南の辺は z = 39。中央は x = 7。
		const door = onEdge(list, 7.5, 39);
		expect(door.map((b) => b.kind)).toEqual(["frame", "entry-door"]);
		const panel = door.find((b) => b.kind === "entry-door");
		expect(panel?.material).toBe("wood-dark");
		expect(panel?.multiply).toBe(WALL_MULTIPLY);
		expect(panel?.color).toBe(WALL_COLOR);
		expect(panel?.height).toBe(FUSUMA_HEIGHT);
		// 両脇の柱。
		expect(
			list.filter(
				(b) => b.kind === "frame" && b.z === 39 && Math.abs(b.x - 7.5) < 0.5,
			),
		).toHaveLength(3);
		for (const x of [5.5, 6.5, 8.5, 9.5]) {
			expect(onEdge(list, x, 39).map((b) => b.kind)).toEqual(["wall"]);
		}
	});
});
