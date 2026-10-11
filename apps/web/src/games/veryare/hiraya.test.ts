import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import {
	FLOOR_EXCEPTIONS,
	FLOOR_HEIGHTS,
	HINGED_SWING,
	type Opening,
	floorHeight,
	isFusumaAxis,
	isHingedAxis,
	isHirayaStage,
	isOpenOpening,
	matchFusuma,
	swingAngle,
} from "./hiraya";
import { parseStageNotice } from "./stage";

const hiraya = parseStageNotice(hirayaFixture.stage);
if (hiraya === null) throw new Error("平屋の見本が読めない");

/**
 * 戸の外枠（操作軸）の開口。assets-src/house/doors-fbx.tsv の親の無い行（中心・長辺の幅・向き）を
 * 書き写したもの。素材のファイルは読まない。
 */
const FUSUMA_AXES: readonly (Opening & { readonly edges: number })[] = [
	{
		name: "ドア 引違い戸 4枚戸 操作軸-002",
		axis: "z",
		x: -0.05,
		z: 4.15,
		width: 3.56,
		edges: 12,
	},
	{
		name: "ドア 引違い戸 4枚戸 操作軸-002.002",
		axis: "z",
		x: -0.05,
		z: 8.8,
		width: 3.56,
		edges: 12,
	},
	{
		name: "ドア 引違い戸 4枚戸 操作軸-002.003",
		axis: "x",
		x: 1.8,
		z: 6.05,
		width: 3.56,
		edges: 12,
	},
	{
		name: "ドア 引違い戸 4枚戸 操作軸-002.004",
		axis: "z",
		x: 3.65,
		z: 8.8,
		width: 3.56,
		edges: 12,
	},
	{
		name: "ドア 引違い戸 操作軸-004",
		axis: "x",
		x: -2.8,
		z: 1.45,
		width: 1.8,
		edges: 6,
	},
	{
		name: "ドア 引違い戸 操作軸-004.001",
		axis: "x",
		x: -1.0,
		z: 1.45,
		width: 1.8,
		edges: 6,
	},
	{
		name: "腰付障子 引違い戸 4枚戸 操作軸-001",
		axis: "z",
		x: -3.75,
		z: 4.2,
		width: 3.56,
		edges: 12,
	},
	{
		name: "腰付障子 引違い戸 4枚戸 操作軸-001.001",
		axis: "z",
		x: -3.75,
		z: 8.8,
		width: 3.56,
		edges: 12,
	},
	{
		name: "腰付障子 引違い戸 4枚戸 操作軸-001.002",
		axis: "x",
		x: -1.9,
		z: 10.65,
		width: 3.56,
		edges: 12,
	},
	{
		name: "腰付障子 引違い戸 4枚戸 操作軸-001.003",
		axis: "x",
		x: 1.8,
		z: 10.65,
		width: 3.56,
		edges: 12,
	},
];

/** 襖でない戸の操作軸（欄間は襖の上の飾り、玄関の戸と片開き戸は襖でない）。 */
const OTHER_AXES = [
	"欄間 4枚戸 操作軸-004",
	"欄間 4枚戸 操作軸-004.001",
	"ドア 引違い戸 玄関欄間 操作軸-001",
	"ドア 片開き戸 室内 操作軸-001 w76",
	"ドア 片開き戸 裏口 操作軸-001 w86",
	"トイレ 収納棚 操作軸-002 w80",
];

const fusumaKeys = [...hiraya.doors]
	.filter(([, kind]) => kind === "fusuma")
	.map(([key]) => key);

describe("isHirayaStage - 通知の形で平屋を見分ける（issue-46）", () => {
	it("平屋の見本は平屋。骨格10種は平屋でない", () => {
		expect(isHirayaStage(hiraya)).toBe(true);
		for (const notice of skeletons.stages) {
			const grid = parseStageNotice(notice);
			expect(grid).not.toBeNull();
			if (grid !== null) expect(isHirayaStage(grid)).toBe(false);
		}
	});

	it("大きさ・原点・玄関のどれか1つでも違えば平屋でない（1項目ずつ変えて確かめる）", () => {
		expect(isHirayaStage({ ...hiraya, cellSize: 1 })).toBe(false);
		expect(isHirayaStage({ ...hiraya, width: 40 })).toBe(false);
		expect(isHirayaStage({ ...hiraya, depth: 44 })).toBe(false);
		expect(isHirayaStage({ ...hiraya, origin: { x: 0, z: -0.275 } })).toBe(
			false,
		);
		expect(isHirayaStage({ ...hiraya, origin: { x: -6.225, z: 0 } })).toBe(
			false,
		);
		expect(isHirayaStage({ ...hiraya, spawn: { x: 4, z: 11.3 } })).toBe(false);
		expect(isHirayaStage({ ...hiraya, spawn: { x: 4.7, z: 11 } })).toBe(false);
	});
});

describe("isFusumaAxis / isHingedAxis - ノードの名前で戸を見分ける", () => {
	it("襖10組の操作軸だけが襖。欄間・玄関・片開き戸・収納棚は襖でない", () => {
		for (const axis of FUSUMA_AXES) expect(isFusumaAxis(axis.name)).toBe(true);
		for (const name of OTHER_AXES) expect(isFusumaAxis(name)).toBe(false);
		// 操作軸の子（板・枠）は、操作軸ではない。
		expect(isFusumaAxis("ドア 引違い戸 4枚戸 本体 内側001-002")).toBe(false);
		expect(isFusumaAxis("ドア 引違い戸 4枚戸 枠-002")).toBe(false);
	});

	it("片開き戸は室内の3つだけ（勝手口はいつも閉じているので回さない）", () => {
		expect(isHingedAxis("ドア 片開き戸 室内 操作軸-001 w76")).toBe(true);
		expect(isHingedAxis("ドア 片開き戸 室内 操作軸-001 w86")).toBe(true);
		expect(isHingedAxis("ドア 片開き戸 室内 操作軸-001 w86.001")).toBe(true);
		expect(isHingedAxis("ドア 片開き戸 裏口 操作軸-001 w86")).toBe(false);
		expect(isHingedAxis("ドア 引違い戸 操作軸-004")).toBe(false);
		expect(Object.keys(HINGED_SWING).sort()).toEqual([
			"ドア 片開き戸 室内 操作軸-001 w76",
			"ドア 片開き戸 室内 操作軸-001 w86",
			"ドア 片開き戸 室内 操作軸-001 w86.001",
		]);
	});
});

describe("matchFusuma - 襖のノードと、戸の一覧の襖10組の対応（issue-46）", () => {
	const matched = matchFusuma(FUSUMA_AXES, hiraya);

	it("10組それぞれが、その襖の辺（6 本か 12 本）に対応する", () => {
		for (const axis of FUSUMA_AXES) {
			expect(matched.get(axis.name)).toHaveLength(axis.edges);
		}
	});

	it("襖の辺 108 本が、ちょうど1回ずつ使われる（隣り合う押入れの2組も混ざらない）", () => {
		const used = [...matched.values()].flat();
		expect(used).toHaveLength(108);
		expect(new Set(used)).toEqual(new Set(fusumaKeys));
		const west = new Set(matched.get("ドア 引違い戸 操作軸-004"));
		for (const key of matched.get("ドア 引違い戸 操作軸-004.001") ?? []) {
			expect(west.has(key)).toBe(false);
		}
	});

	it("対応する辺の無い開口（玄関の戸の位置）は、空になる", () => {
		const entrance = matchFusuma(
			[{ name: "玄関", axis: "x", x: 4.7, z: 12.0, width: 1.8 }],
			hiraya,
		);
		expect(entrance.get("玄関")).toEqual([]);
	});
});

describe("isOpenOpening - 襖のノードを開けた位置に置くか", () => {
	it("対応する辺のどれかが開いていれば開ける。辺が無ければ閉じたまま", () => {
		expect(isOpenOpening(["a", "b"], new Set(["b"]))).toBe(true);
		expect(isOpenOpening(["a", "b"], new Set())).toBe(false);
		expect(isOpenOpening([], new Set(["a"]))).toBe(false);
	});
});

describe("swingAngle - 片開き戸を丁番で 90 度回して開いた姿にする", () => {
	/** y 軸まわりに angle だけ回した位置（three の回転と同じ向き）。 */
	const rotate = (p: { x: number; z: number }, angle: number) => ({
		x: p.x * Math.cos(angle) + p.z * Math.sin(angle),
		z: -p.x * Math.sin(angle) + p.z * Math.cos(angle),
	});

	it("回した後の板の中心は、指定した側（z の正・負）に来て、丁番からの距離は変わらない", () => {
		// 風呂-洗面所（tsv: 丁番 (3.751, 1.848)、本体の中心 (4.105, 1.807)）。
		const hinge = { x: 3.751, z: 1.848 };
		const center = { x: 4.105, z: 1.807 };
		const arm = { x: center.x - hinge.x, z: center.z - hinge.z };
		for (const side of [1, -1] as const) {
			const turned = rotate(arm, swingAngle(hinge, center, side));
			expect(Math.sign(turned.z)).toBe(side);
			expect(Math.hypot(turned.x, turned.z)).toBeCloseTo(
				Math.hypot(arm.x, arm.z),
				9,
			);
			expect(Math.abs(turned.x)).toBeLessThan(0.05);
		}
	});
});

describe("floorHeight - 床の高さの表（issue-46。tools/floor_heights.mjs で glb から測った値）", () => {
	const at = (x: number, z: number) => ({
		x: hiraya.origin.x + hiraya.cellSize * (x + 0.5),
		z: hiraya.origin.z + hiraya.cellSize * (z + 0.5),
	});

	it("歩けるすべての領域に、床の高さがある（抜けがあれば落ちる）", () => {
		for (const char of Object.keys(hirayaFixture.stage.regions)) {
			expect(FLOOR_HEIGHTS[char], `領域 ${char}`).toBeTypeOf("number");
		}
	});

	it("例外のマスは、どれも歩けるマスで、書いた領域の文字と地図が合う", () => {
		for (const [x, z, char] of FLOOR_EXCEPTIONS) {
			expect(hiraya.charAt({ x, z })).toBe(char);
			expect(hiraya.regionAt({ x, z })).not.toBeNull();
		}
	});

	it("平屋の glb を表示しているときは、マスの床の高さ（例外のマスは、そのマスの値）", () => {
		expect(floorHeight(hiraya, hiraya.spawn, true)).toBe(0.4);
		expect(floorHeight(hiraya, at(30, 30), true)).toBe(0.6);
		expect(floorHeight(hiraya, at(1, 30), true)).toBe(0.55);
		expect(floorHeight(hiraya, at(9, 21), true)).toBe(0.72);
		expect(floorHeight(hiraya, at(15, 23), true)).toBe(0.62);
		expect(floorHeight(hiraya, at(37, 13), true)).toBe(0.8);
		expect(floorHeight(hiraya, at(22, 2), true)).toBe(0.4);
		expect(floorHeight(hiraya, at(36, 36), true)).toBe(0.6);
	});

	it("箱の表示のとき、平屋でない地図、歩けないマスでは 0", () => {
		expect(floorHeight(hiraya, hiraya.spawn, false)).toBe(0);
		const skeleton = parseStageNotice(skeletons.stages[0]);
		if (skeleton === null) throw new Error("骨格の見本が読めない");
		expect(floorHeight(skeleton, skeleton.spawn, true)).toBe(0);
		expect(floorHeight(hiraya, at(0, 0), true)).toBe(0);
	});
});
