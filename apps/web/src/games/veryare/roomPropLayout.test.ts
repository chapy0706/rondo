import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import {
	type LocalProp,
	type LocalRoom,
	PROP_MAX_ROOMS,
	PROP_PATH_WIDTH,
	PROP_WALL_MARGIN,
	type Rect,
	layoutInRoom,
	localFootprint,
	pathRects,
	placeRoomProps,
	propRooms,
	roomSeed,
	worldFootprint,
	worldRect,
} from "./roomPropLayout";
import {
	PROP_SIZES,
	PROP_TRIANGLES,
	PROP_TRIANGLE_BUDGET,
	type PropKind,
} from "./roomProps";
import { type StageGrid, parseStageNotice } from "./stage";

/** 和室系の大スロットの形（どの骨格でも、4 × 6 m か 6 × 4 m。1 マス 1 m）。 */
const SHAPES = [
	{ width: 6, depth: 4 },
	{ width: 4, depth: 6 },
] as const;

/** 襖の位置（襖のある辺の、すべてのマスの中心）。 */
function doors(width: number): number[] {
	return Array.from({ length: width }, (_, i) => i + 0.5);
}

/** 試す種の数。 */
const SEEDS = 300;

const EPS = 1e-9;

function overlaps(a: Rect, b: Rect): boolean {
	return (
		Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > EPS &&
		Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > EPS
	);
}

function inside(inner: Rect, outer: Rect): boolean {
	return (
		inner.x0 >= outer.x0 - EPS &&
		inner.z0 >= outer.z0 - EPS &&
		inner.x1 <= outer.x1 + EPS &&
		inner.z1 <= outer.z1 + EPS
	);
}

/** 部屋の、壁から余白を取った内側（部屋の座標）。 */
function innerRect(room: LocalRoom): Rect {
	return {
		x0: PROP_WALL_MARGIN,
		z0: PROP_WALL_MARGIN,
		x1: room.width - PROP_WALL_MARGIN,
		z1: room.depth - PROP_WALL_MARGIN,
	};
}

/** 床に置く小物（ちゃぶ台の上の湯呑みを除く）。 */
const onFloor = (prop: LocalProp) => prop.y === 0;

function expectRoomRules(room: LocalRoom, props: readonly LocalProp[]) {
	const floor = props.filter(onFloor);
	const paths = pathRects(room);
	for (const prop of floor) {
		const rect = localFootprint(prop);
		expect(inside(rect, innerRect(room)), `${prop.kind} が部屋の内側`).toBe(
			true,
		);
		for (const path of paths) {
			expect(overlaps(rect, path), `${prop.kind} が通り道をふさがない`).toBe(
				false,
			);
		}
	}
	for (let i = 0; i < floor.length; i++) {
		for (let j = i + 1; j < floor.length; j++) {
			const a = floor[i] as LocalProp;
			const b = floor[j] as LocalProp;
			expect(
				overlaps(localFootprint(a), localFootprint(b)),
				`${a.kind} × ${b.kind}`,
			).toBe(false);
		}
	}
	// 湯呑みは、ちゃぶ台の天板の上（天板の内側、天板の高さ）。
	for (const cup of props.filter((p) => p.kind === "yunomi")) {
		const table = floor.find((p) => p.kind === "chabudai");
		if (table === undefined) throw new Error("ちゃぶ台の無い湯呑み");
		expect(cup.y).toBe(PROP_SIZES.chabudai.height);
		expect(inside(localFootprint(cup), localFootprint(table))).toBe(true);
	}
}

describe("layoutInRoom - 1 部屋の置き方（部屋の座標: u は襖の辺に沿う、v は襖から奥へ）", () => {
	for (const shape of SHAPES) {
		describe(`${shape.width} × ${shape.depth} m（襖の辺が ${shape.width} m）`, () => {
			for (const door of doors(shape.width)) {
				it(`襖の中心 u = ${door}: どの種でも、部屋の内側に収まり、重ならず、通り道をふさがない。数は 0 か 2〜4`, () => {
					const room = { ...shape, door };
					for (let seed = 0; seed < SEEDS; seed++) {
						const layout = layoutInRoom(room, seed);
						expectRoomRules(room, layout.props);
						expect([0, 2, 3, 4]).toContain(layout.props.length);
						if (layout.pattern === null) expect(layout.props).toEqual([]);
					}
				});

				it(`襖の中心 u = ${door}: 型 A・B・C のどれも出て、置かない部屋も出る。左右の反転も出る`, () => {
					const room = { ...shape, door };
					const patterns = new Set<string | null>();
					const mirrored = new Set<boolean>();
					for (let seed = 0; seed < SEEDS; seed++) {
						const layout = layoutInRoom(room, seed);
						if (layout.props.length > 0) {
							patterns.add(layout.pattern);
							mirrored.add(layout.mirrored);
						} else {
							patterns.add(null);
						}
					}
					expect([...patterns].sort()).toEqual(["A", "B", "C", null].sort());
					expect([...mirrored].sort()).toEqual([false, true]);
				});
			}
		});
	}

	it("同じ部屋と種なら、同じ置き方（決定的）", () => {
		const room = { width: 6, depth: 4, door: 3.5 };
		for (let seed = 0; seed < 50; seed++) {
			expect(layoutInRoom(room, seed)).toEqual(layoutInRoom(room, seed));
		}
	});

	it("通り道は、襖から部屋の中央まで、幅 0.9 m", () => {
		const room = { width: 6, depth: 4, door: 0.5 };
		const [toward, across] = pathRects(room);
		expect(PROP_PATH_WIDTH).toBe(0.9);
		const close = (actual: Rect, expected: Rect) => {
			for (const key of ["x0", "z0", "x1", "z1"] as const) {
				expect(actual[key], key).toBeCloseTo(expected[key], 9);
			}
		};
		close(toward, { x0: 0.05, z0: 0, x1: 0.95, z1: 2.45 });
		close(across, { x0: 0.05, z0: 1.55, x1: 3.45, z1: 2.45 });
	});
});

const stages = [...skeletons.stages, ...skeletons.wideStages].map(
	(notice, i) => {
		const grid = parseStageNotice(notice);
		if (grid === null) throw new Error(`見本 ${i + 1} が読めない`);
		return [i + 1, grid] as const;
	},
);

/** 小物ごとの三角形の数の上限で数えた、地図の小物の三角形の数。 */
function triangles(grid: StageGrid): number {
	return placeRoomProps(grid).reduce(
		(sum, prop) => sum + PROP_TRIANGLES[prop.kind as PropKind],
		0,
	);
}

describe("placeRoomProps - 地図の置き方（契約の見本の 13 種: 10 種と、広い屋敷のはじめの 3 種）", () => {
	for (const [n, grid] of stages) {
		it(`見本 ${n}: 和室系の部屋はどれも 4 × 6 m の矩形で、襖は 1 つ`, () => {
			const rooms = propRooms(grid);
			const washitsu = Object.entries(grid.rooms).filter(([, type]) =>
				type.startsWith("washitsu"),
			);
			expect(rooms.length).toBe(washitsu.length);
			for (const room of rooms) {
				expect([room.local.width, room.local.depth].sort()).toEqual([4, 6]);
			}
		});

		it(`見本 ${n}: 小物は、和室の内側に収まり、重ならず、襖から部屋の中央までの通り道をふさがない`, () => {
			const placed = placeRoomProps(grid);
			for (const room of propRooms(grid)) {
				const mine = placed.filter((p) => p.room === room.id);
				const floor = mine.filter((p) => p.y === 0);
				const bounds = worldRect(room.frame, innerRect(room.local));
				const paths = pathRects(room.local).map((r) =>
					worldRect(room.frame, r),
				);
				for (const prop of floor) {
					const rect = worldFootprint(prop);
					expect(inside(rect, bounds), `${room.id} の ${prop.kind}`).toBe(true);
					for (const path of paths) expect(overlaps(rect, path)).toBe(false);
				}
				for (let i = 0; i < floor.length; i++) {
					for (let j = i + 1; j < floor.length; j++) {
						expect(
							overlaps(
								worldFootprint(floor[i] as (typeof floor)[number]),
								worldFootprint(floor[j] as (typeof floor)[number]),
							),
						).toBe(false);
					}
				}
			}
		});

		it(`見本 ${n}: 押し入れ・廊下・縁側・玄関には置かない。置く部屋は上限以下。三角形の増えは 3 万以下`, () => {
			const placed = placeRoomProps(grid);
			const ids = new Set(propRooms(grid).map((room) => room.id));
			for (const prop of placed) expect(ids.has(prop.room)).toBe(true);
			expect(new Set(placed.map((p) => p.room)).size).toBeLessThanOrEqual(
				PROP_MAX_ROOMS,
			);
			expect(triangles(grid)).toBeLessThanOrEqual(PROP_TRIANGLE_BUDGET);
		});

		it(`見本 ${n}: ちゃぶ台の脇の座椅子は、ちゃぶ台を向く。手前の座椅子は、奥を向く（部屋の向きが裏返しでも）`, () => {
			const placed = placeRoomProps(grid);
			for (const room of propRooms(grid)) {
				const mine = placed.filter((p) => p.room === room.id);
				const table = mine.find((p) => p.kind === "chabudai");
				for (const chair of mine.filter((p) => p.kind === "zaisu")) {
					// 座椅子の正面は、キットの +x（rotation.y = yaw で (cos yaw, -sin yaw) を向く）。
					const front = { x: Math.cos(chair.yaw), z: -Math.sin(chair.yaw) };
					const target =
						table === undefined
							? { x: room.frame.v.x, z: room.frame.v.z }
							: { x: table.x - chair.x, z: table.z - chair.z };
					expect(front.x * target.x + front.z * target.z).toBeGreaterThan(0);
				}
			}
		});

		it(`見本 ${n}: 同じ地図なら同じ置き方（決定的）`, () => {
			expect(placeRoomProps(grid)).toEqual(placeRoomProps(grid));
		});
	}

	it("どの地図でも、小物を置いた部屋がある（置かない部屋だけにならない）", () => {
		for (const [, grid] of stages) {
			expect(placeRoomProps(grid).length).toBeGreaterThan(0);
		}
	});

	it("部屋ごとの種は、地図の文字列と部屋の文字から作る（地図が違えば、種が変わる）", () => {
		const [, a] = stages[0] as (typeof stages)[number];
		const [, b] = stages[1] as (typeof stages)[number];
		expect(roomSeed(a, "A")).toBe(roomSeed(a, "A"));
		expect(roomSeed(a, "A")).not.toBe(roomSeed(a, "B"));
		expect(roomSeed(a, "A")).not.toBe(roomSeed(b, "A"));
	});

	it("型の上限で数えても、三角形の増えは 3 万以下（どの部屋も型 A のとき）", () => {
		const worst =
			PROP_MAX_ROOMS *
			(PROP_TRIANGLES.chabudai +
				2 * PROP_TRIANGLES.zaisu +
				PROP_TRIANGLES.yunomi);
		expect(worst).toBeLessThanOrEqual(PROP_TRIANGLE_BUDGET);
	});

	it("平屋には置かない（すでに小物がある）", () => {
		const grid = parseStageNotice(hirayaFixture.stage);
		if (grid === null) throw new Error("平屋の見本が読めない");
		expect(placeRoomProps(grid)).toEqual([]);
	});
});
