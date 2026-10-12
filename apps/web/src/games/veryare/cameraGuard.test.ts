import { describe, expect, it } from "vitest";
import { CAMERA_WALL_MARGIN, DEFAULT_CAMERA, EYE_HEIGHT } from "./camera";
import { cameraProblems, problemText } from "./cameraCheck";
import {
	CAMERA_FOV,
	CAMERA_FURNITURE_MARGIN,
	CAMERA_MAX_ASPECT,
	CAMERA_NEAR,
	type FurnitureBox,
	NEAR_CLEARANCE,
	WALL_FACE_OFFSET,
	allowedCameraReach,
	bodyOverlapsBox,
	boundaryEdges,
	distanceToBox,
	distanceToSegment,
	nearPlaneReach,
	placeGuardedCamera,
	segmentHitsBox,
} from "./cameraGuard";
import { cameraReach, fullReach, reachedPose } from "./cameraRig";
import { type StageGrid, parseStageNotice } from "./stage";

// --- 合成の部屋 -------------------------------------------------------------------
//
// 1マス 0.3 m、原点 (0, 0)。
//   A: 和室（x 1〜8、z 1〜6）。東の C とは壁で、z 3〜4 だけ襖。南の廊下 P とは、いつも開いている戸
//   C: 洋室（x 9〜16、z 1〜6）
//   P: 狭い廊下（x 3〜4、z 7〜12。幅 0.6 m）
//   E: L 字の部屋（x 1〜10、z 13〜15 と、x 8〜10、z 10〜12）。出っ張った角が (8, 13) の北西にある
const W = 18;
const D = 17;
const charOf = (x: number, z: number): string => {
	if (x >= 1 && x <= 8 && z >= 1 && z <= 6) return "A";
	if (x >= 9 && x <= 16 && z >= 1 && z <= 6) return "C";
	if (x >= 3 && x <= 4 && z >= 7 && z <= 12) return "P";
	if (x >= 1 && x <= 10 && z >= 13 && z <= 15) return "E";
	if (x >= 8 && x <= 10 && z >= 10 && z <= 12) return "E";
	return "~";
};
const rows = Array.from({ length: D }, (_, z) =>
	Array.from({ length: W }, (_, x) => charOf(x, z)).join(""),
);
const door = (
	ax: number,
	az: number,
	bx: number,
	bz: number,
	kind: string,
) => ({
	a: { x: ax, z: az },
	b: { x: bx, z: bz },
	kind,
});
const grid = parseStageNotice({
	type: "stage",
	cellSize: 0.3,
	origin: { x: 0, z: 0 },
	width: W,
	depth: D,
	rows,
	regions: { A: "A", C: "C", P: "P", E: "E" },
	rooms: { A: "washitsu", C: "dining" },
	doors: [
		door(8, 3, 9, 3, "fusuma"),
		door(8, 4, 9, 4, "fusuma"),
		door(3, 6, 3, 7, "always-open"),
		door(4, 6, 4, 7, "always-open"),
		door(3, 12, 3, 13, "always-open"),
		door(4, 12, 4, 13, "always-open"),
	],
	spawn: { x: 1.0, z: 1.0 },
}) as StageGrid;
if (grid === null) throw new Error("合成の部屋が読めない");

const box = (
	name: string,
	min: [number, number, number],
	max: [number, number, number],
): FurnitureBox => ({
	name,
	min: { x: min[0], y: min[1], z: min[2] },
	max: { x: max[0], y: max[1], z: max[2] },
});

/** 家具（足もとの高さ 0 のときの位置。段差のときは、床の高さぶん上げて置く）。 */
const furnitureAt = (floor: number): FurnitureBox[] =>
	[
		// A の北東の隅の、壁際の高いタンス。
		box("タンス", [2.1, 0, 0.3], [2.7, 1.5, 0.75]),
		// A の中ほどの、低い座卓（目の高さより低い）。
		box("座卓", [0.9, 0, 0.9], [1.5, 0.4, 1.5]),
		// A の吊り下げの照明（カメラの高さにかかる）。
		box("照明", [1.0, 1.9, 1.0], [1.4, 2.3, 1.4]),
		// C の中ほどの、背の高い棚。
		box("棚", [3.6, 0, 0.9], [4.0, 2.0, 1.2]),
		// E の、壁から離れた冷蔵庫。
		box("冷蔵庫", [1.2, 0, 4.2], [1.8, 1.8, 4.5]),
	].map((b) => ({
		...b,
		min: { ...b.min, y: b.min.y + floor },
		max: { ...b.max, y: b.max.y + floor },
	}));

/** 体の位置: 歩けるマスの中心と、マスの4つの辺のすぐ内側（壁に接するいちばん端）。 */
function bodyPositions(g: StageGrid): { x: number; z: number }[] {
	const list: { x: number; z: number }[] = [];
	const edge = g.cellSize / 2 - 0.002;
	for (let z = 0; z < g.depth; z++) {
		for (let x = 0; x < g.width; x++) {
			if (g.regionAt({ x, z }) === null) continue;
			const cx = g.origin.x + g.cellSize * (x + 0.5);
			const cz = g.origin.z + g.cellSize * (z + 0.5);
			list.push(
				{ x: cx, z: cz },
				{ x: cx + edge, z: cz },
				{ x: cx - edge, z: cz },
				{ x: cx, z: cz + edge },
				{ x: cx, z: cz - edge },
			);
		}
	}
	return list;
}

// --- 部品 -------------------------------------------------------------------------

describe("定数 - 壁の余白はニアクリップより大きい（壁の中が映らない）", () => {
	it("ニアクリップ 0.03 m・画角 60°・横長 2.4 のニアクリップの面の角までの距離は約 0.054 m", () => {
		expect(CAMERA_NEAR).toBe(0.03);
		expect(CAMERA_FOV).toBe(60);
		expect(CAMERA_MAX_ASPECT).toBe(2.4);
		expect(
			nearPlaneReach(CAMERA_NEAR, CAMERA_FOV, CAMERA_MAX_ASPECT),
		).toBeCloseTo(0.054, 3);
		expect(NEAR_CLEARANCE).toBe(
			nearPlaneReach(CAMERA_NEAR, CAMERA_FOV, CAMERA_MAX_ASPECT),
		);
	});

	it("壁の余白（0.2 m）は、壁の面のずれ（実測 0.125 m）とニアクリップの面の角までの距離の和より大きい", () => {
		expect(WALL_FACE_OFFSET).toBe(0.125);
		expect(CAMERA_WALL_MARGIN).toBeGreaterThan(
			WALL_FACE_OFFSET + NEAR_CLEARANCE,
		);
		expect(CAMERA_FURNITURE_MARGIN).toBeGreaterThan(NEAR_CLEARANCE);
	});
});

describe("bodyOverlapsBox - 体の円柱（半径 0.2 m・高さ 1.6 m）が箱に重なるか", () => {
	const b = box("タンス", [1, 0, 0], [2, 1.5, 1]);
	it("水平に半径より近く、高さが重なれば重なる", () => {
		expect(bodyOverlapsBox({ x: 0.85, z: 0.5, feet: 0 }, b)).toBe(true);
		expect(bodyOverlapsBox({ x: 1.5, z: 0.5, feet: 0 }, b)).toBe(true);
	});
	it("水平に半径より遠い、または高さが重ならなければ、重ならない", () => {
		expect(bodyOverlapsBox({ x: 0.7, z: 0.5, feet: 0 }, b)).toBe(false);
		expect(bodyOverlapsBox({ x: 1.5, z: 0.5, feet: 1.6 }, b)).toBe(false);
		const high = box("照明", [1, 1.7, 0], [2, 2, 1]);
		expect(bodyOverlapsBox({ x: 0.9, z: 0.5, feet: 0 }, high)).toBe(false);
	});
});

describe("segmentHitsBox - 線分と箱", () => {
	const b = box("箱", [0, 0, 0], [1, 1, 1]);
	it("最初に入る割合（0〜1）。当たらなければ null。始点が中なら 0", () => {
		expect(
			segmentHitsBox({ x: -1, y: 0.5, z: 0.5 }, { x: 2, y: 0.5, z: 0.5 }, b),
		).toBeCloseTo(1 / 3, 9);
		expect(
			segmentHitsBox({ x: -1, y: 1.5, z: 0.5 }, { x: 2, y: 1.5, z: 0.5 }, b),
		).toBeNull();
		expect(
			segmentHitsBox({ x: -1, y: 0.5, z: 0.5 }, { x: -0.5, y: 0.5, z: 0.5 }, b),
		).toBeNull();
		expect(
			segmentHitsBox({ x: 0.5, y: 0.5, z: 0.5 }, { x: 3, y: 3, z: 3 }, b),
		).toBe(0);
	});
});

describe("distanceToBox・distanceToSegment・boundaryEdges", () => {
	it("箱までの距離（中なら 0）", () => {
		const b = box("箱", [0, 0, 0], [1, 1, 1]);
		expect(distanceToBox({ x: 2, y: 0.5, z: 0.5 }, b)).toBeCloseTo(1, 9);
		expect(distanceToBox({ x: 0.5, y: 0.5, z: 0.5 }, b)).toBe(0);
	});

	it("線分までの距離", () => {
		expect(
			distanceToSegment({ x: 0.5, z: 1 }, { x: 0, z: 0 }, { x: 1, z: 0 }),
		).toBeCloseTo(1, 9);
		expect(
			distanceToSegment({ x: 2, z: 0 }, { x: 0, z: 0 }, { x: 1, z: 0 }),
		).toBeCloseTo(1, 9);
	});

	it("領域の境（壁・すべての戸・歩けないマスとの境）の辺。同じ領域どうしは境でない", () => {
		const edges = boundaryEdges(grid, { x: 1, z: 1 });
		// (1,1) は A の北西の隅: 北と西が境。
		expect(edges.length).toBeGreaterThanOrEqual(2);
		// 襖の辺 (8,3)|(9,3) も境（カメラは戸を越えない / ADR 0043）。
		const nearDoor = boundaryEdges(grid, { x: 8, z: 3 });
		expect(
			nearDoor.some(
				(e) => Math.abs(e.from.x - 2.7) < 1e-9 && Math.abs(e.to.x - 2.7) < 1e-9,
			),
		).toBe(true);
	});
});

describe("allowedCameraReach・placeGuardedCamera - 地図と家具の守り", () => {
	const full = fullReach(DEFAULT_CAMERA);

	it("家具が無く、開けた所なら、これまでどおり（地図の守りだけ）", () => {
		// C の中ほど (x 13, z 3)。北（yaw π）へは 0.9 m で壁なので、南（yaw 0）を見る……C は z 1〜6
		// なので、z 方向は狭い。西（yaw -π/2）は、x 9 の手前で止まる。ここでは家具なしで、地図の守りと同じ。
		const body = { x: 0.3 * 13.5, z: 0.3 * 3.5 };
		for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
			const want = {
				x: body.x + Math.sin(yaw) * full,
				z: body.z + Math.cos(yaw) * full,
			};
			const map = Math.max(
				0,
				Math.min(
					full,
					cameraReach(grid, body, want) * full - CAMERA_WALL_MARGIN,
				),
			);
			const reach = allowedCameraReach(grid, { ...body, feet: 0 }, yaw, []);
			expect(reach).toBeLessThanOrEqual(map + 1e-9);
			expect(reach).toBeGreaterThanOrEqual(map - 0.06);
		}
	});

	it("背の高い家具が体とカメラの間にあれば、手前で止める（棚の向こうへカメラを出さない）", () => {
		// C の棚（x 3.6〜4.0）の西に立ち、カメラを東（棚の側。yaw π/2）に置く。
		const body = { x: 3.3, z: 1.05, feet: 0 };
		const boxes = furnitureAt(0);
		const withShelf = allowedCameraReach(grid, body, Math.PI / 2, boxes);
		const without = allowedCameraReach(grid, body, Math.PI / 2, []);
		expect(withShelf).toBeLessThan(without);
		const pose = placeGuardedCamera(grid, body, Math.PI / 2, withShelf, boxes);
		const eye = { x: body.x, y: body.feet + EYE_HEIGHT, z: body.z };
		const shelf = boxes.find((b) => b.name === "棚") as FurnitureBox;
		expect(segmentHitsBox(eye, pose.position, shelf)).toBeNull();
	});

	it("低い家具（線が箱の上を通る）は、止めない", () => {
		// A の座卓（x 0.9〜1.5、高さ 0.4）の西に立ち、カメラを東（座卓の側）に置く。
		const body = { x: 0.6, z: 1.2, feet: 0 };
		const low = furnitureAt(0).filter((b) => b.name === "座卓");
		expect(allowedCameraReach(grid, body, Math.PI / 2, low)).toBe(
			allowedCameraReach(grid, body, Math.PI / 2, []),
		);
	});

	it("カメラの位置は、地図の守りのとおり体と同じ高さの線上で、目印の位置（見る点）は変えない", () => {
		const body = { x: 0.3 * 13.5, z: 0.3 * 3.5, feet: 0.6 };
		const reach = allowedCameraReach(grid, body, 0, []);
		const pose = placeGuardedCamera(grid, body, 0, reach, []);
		const base = reachedPose(body, 0, reach);
		expect(pose.target).toEqual(base.target);
		expect(pose.position.y).toBeCloseTo(base.position.y, 9);
	});
});

// --- 判定（cameraCheck.ts）が空振りしない -----------------------------------------

describe("cameraProblems - めり込みの判定", () => {
	const boxes = furnitureAt(0);
	const body = { x: 0.6, z: 1.2 };

	it("問題の無い位置では、空", () => {
		expect(
			cameraProblems(grid, body, 0, { x: 0.9, y: 1.4, z: 1.8 }, boxes),
		).toEqual([]);
	});

	it("壁際・領域の外・箱の中・箱の近く・体を隠す箱を、それぞれ問題にする", () => {
		expect(
			cameraProblems(grid, body, 0, { x: 0.35, y: 1.4, z: 1.2 }, []).map(
				(p) => p.kind,
			),
		).toEqual(["wall"]);
		expect(
			cameraProblems(grid, body, 0, { x: 3.3, y: 1.4, z: 1.2 }, []).map(
				(p) => p.kind,
			),
		).toContain("region");
		const tansu = cameraProblems(
			grid,
			body,
			0,
			{ x: 2.3, y: 1.0, z: 0.5 },
			boxes,
		);
		expect(tansu.map(problemText)).toContain("タンス の中");
		const close = cameraProblems(
			grid,
			{ x: 3.3, z: 1.05 },
			0,
			{ x: 3.58, y: 1.2, z: 1.05 },
			boxes,
		);
		expect(close.map((p) => p.kind)).toContain("near");
		const hides = cameraProblems(
			grid,
			{ x: 3.3, z: 1.05 },
			0,
			{ x: 4.3, y: 1.6, z: 1.05 },
			boxes,
		);
		expect(hides.map(problemText)).toContain("棚 が体を隠す");
	});
});

// --- (a) 全探索 -------------------------------------------------------------------

describe("(a) 全探索: 歩けるマスのすべて × 視点の向き16方向 × 体の高さの最小・最大", () => {
	it("カメラは、壁の厚みの中にも、家具の箱の中にも入らず、近くの面からニアクリップ以上離れ、体の領域の外に出ない", () => {
		const problems: string[] = [];
		const bodies = bodyPositions(grid);
		for (const feet of [0, 0.8]) {
			const boxes = furnitureAt(feet);
			for (const body of bodies) {
				const center = { ...body, feet };
				for (let k = 0; k < 16; k++) {
					const yaw = (k / 16) * 2 * Math.PI;
					const reach = allowedCameraReach(grid, center, yaw, boxes);
					const pose = placeGuardedCamera(grid, center, yaw, reach, boxes);
					const p = pose.position;
					const where = `体 (${body.x.toFixed(3)}, ${body.z.toFixed(3)})・床 ${feet}・向き ${k}`;
					for (const problem of cameraProblems(grid, body, feet, p, boxes)) {
						problems.push(`${where}: ${problemText(problem)}`);
					}
				}
			}
		}
		expect(problems.slice(0, 20)).toEqual([]);
		expect(problems).toHaveLength(0);
	});
});
