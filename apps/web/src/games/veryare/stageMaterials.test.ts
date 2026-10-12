import { describe, expect, it } from "vitest";
import { FLOOR_COLOR, ROOM_COLORS } from "./palette";
import { parseStageNotice } from "./stage";
import {
	CEILING_MULTIPLY,
	FLOOR_MATERIALS,
	STAGE_MATERIAL_EXTRAS_KEY,
	STAGE_MATERIAL_KEYS,
	SURFACE_MATERIALS,
	WALL_MULTIPLY,
	floorMaterial,
	floorUv,
	lightness,
	multiplyFactor,
	parseStageMaterials,
	placeKind,
	roomCorners,
	shadedMean,
	tintFactor,
	wallUv,
} from "./stageMaterials";

// 1マス 1 m の小さな間取り。
//   x: 0123456
//   0  ~=..@~~
//   1  ~=AA+bb
//   2  ~=AA.KK
const grid = parseStageNotice({
	type: "stage",
	cellSize: 1,
	origin: { x: 0, z: 0 },
	width: 7,
	depth: 3,
	rows: ["~=..@~~", "~=AA+bb", "~=AA.KK"],
	regions: {
		"=": "open",
		".": "open",
		"+": "open",
		"@": "open",
		A: "A",
		b: "b",
		K: "K",
	},
	rooms: { A: "washitsu", b: "oshiire", K: "kitchen" },
	doors: [],
	spawn: { x: 3.5, z: 0.5 },
});
if (grid === null) throw new Error("見本が読めない");

describe("placeKind・floorMaterial - 場所 → 材質の鍵（提案の対応表）", () => {
	it("地図の文字: 廊下（. +）・縁側（=）・玄関（@）", () => {
		expect(placeKind(grid, { x: 2, z: 0 })).toBe("corridor");
		expect(placeKind(grid, { x: 4, z: 1 })).toBe("corridor");
		expect(placeKind(grid, { x: 1, z: 0 })).toBe("engawa");
		expect(placeKind(grid, { x: 4, z: 0 })).toBe("genkan");
		expect(placeKind(grid, { x: 0, z: 0 })).toBeNull();
	});

	it("部屋タイプ: 和室（3種類）は畳、押し入れは木目（濃い）、それ以外の部屋は板", () => {
		for (const room of ["washitsu", "washitsu-oshiire", "washitsu-kakejiku"]) {
			const variant = parseStageNotice({
				type: "stage",
				cellSize: 1,
				origin: { x: 0, z: 0 },
				width: 2,
				depth: 1,
				rows: ["AA"],
				regions: { A: "A" },
				rooms: { A: room },
				doors: [],
				spawn: { x: 0.5, z: 0.5 },
			});
			if (variant === null) throw new Error("読めない");
			expect(placeKind(variant, { x: 1, z: 0 })).toBe("washitsu");
			expect(floorMaterial(variant, { x: 1, z: 0 })?.material).toBe("tatami");
			expect(floorMaterial(variant, { x: 1, z: 0 })?.tint).toBe(
				ROOM_COLORS[room],
			);
		}
		expect(placeKind(grid, { x: 2, z: 1 })).toBe("washitsu");
		expect(placeKind(grid, { x: 5, z: 1 })).toBe("oshiire");
		expect(placeKind(grid, { x: 5, z: 2 })).toBe("room");
		expect(floorMaterial(grid, { x: 2, z: 1 })?.material).toBe("tatami");
		expect(floorMaterial(grid, { x: 5, z: 1 })?.material).toBe("wood-dark");
		expect(floorMaterial(grid, { x: 5, z: 2 })?.material).toBe("wood-board");
	});

	it("すべての組み合わせの材質（対応表は1か所のデータ）", () => {
		expect(FLOOR_MATERIALS).toEqual({
			washitsu: "tatami",
			oshiire: "wood-dark",
			room: "wood-board",
			corridor: "wood-board",
			engawa: "wood-dark",
			genkan: "doma",
		});
		expect(SURFACE_MATERIALS).toEqual({
			wall: "wood-dark",
			fusuma: "fusuma",
			frame: "wood-dark",
			"fixed-door": "wood-dark",
			"entry-door": "wood-dark",
			ceiling: "wood-board",
			"dummy-fusuma": "fusuma",
			hikite: "wood-dark",
		});
		for (const key of [
			...Object.values(FLOOR_MATERIALS),
			...Object.values(SURFACE_MATERIALS),
		]) {
			expect(STAGE_MATERIAL_KEYS).toContain(key);
		}
		// 素材の鍵は、どこかで使うものだけ（壁紙・障子は使わないので持たない）。
		expect(
			new Set([
				...Object.values(FLOOR_MATERIALS),
				...Object.values(SURFACE_MATERIALS),
			]),
		).toEqual(new Set(STAGE_MATERIAL_KEYS));
	});

	it("床の寄せる色は、その場の代表色（玄関は廊下と同じ茶色）", () => {
		expect(floorMaterial(grid, { x: 2, z: 1 })?.tint).toBe(
			ROOM_COLORS.washitsu,
		);
		expect(floorMaterial(grid, { x: 5, z: 1 })?.tint).toBe(ROOM_COLORS.oshiire);
		expect(floorMaterial(grid, { x: 4, z: 0 })?.tint).toBe(FLOOR_COLOR);
		expect(floorMaterial(grid, { x: 1, z: 1 })?.tint).toBe(FLOOR_COLOR);
		expect(floorMaterial(grid, { x: 0, z: 0 })).toBeNull();
	});

	it("畳の絵の原点は、部屋（スロット）の隅。ほかの床は世界の原点", () => {
		expect(roomCorners(grid).get("A")).toEqual({ x: 2, z: 1 });
		expect(floorMaterial(grid, { x: 3, z: 2 })?.origin).toEqual({ x: 2, z: 1 });
		expect(floorMaterial(grid, { x: 2, z: 0 })?.origin).toEqual({ x: 0, z: 0 });
	});
});

describe("floorUv・wallUv - 世界の座標からの UV（1枚の大きさで割る）", () => {
	it("床は x・z を、原点からの距離 ÷ 1枚の大きさ", () => {
		const uv = floorUv({ x: 3.8, z: 2.9 }, { x: 2, z: 1 }, [1.8, 1.8]);
		expect(uv.u).toBeCloseTo(1, 12);
		expect(uv.v).toBeCloseTo(1.9 / 1.8, 12);
	});

	it("隣の箱との継ぎ目で、模様がつながる（同じ点は同じ UV）", () => {
		const tile: [number, number] = [1, 1];
		const leftEdge = floorUv({ x: 3, z: 0.4 }, { x: 0, z: 0 }, tile);
		const rightStart = floorUv({ x: 3, z: 0.4 }, { x: 0, z: 0 }, tile);
		expect(leftEdge).toEqual(rightStart);
	});

	it("壁は、u が壁に沿う向きの位置、v が −高さ（木目が絵の縦に走る wood-dark で、壁の木目が縦になる。絵の上の行が高い位置に来る）", () => {
		const uv = wallUv(2.5, 1.2, [2, 2]);
		expect(uv.u).toBeCloseTo(1.25, 12);
		expect(uv.v).toBeCloseTo(-0.6, 12);
		// 高さが変わっても u は変わらない（縦の木目は、高さの向きに伸びる）。
		expect(wallUv(2.5, 2.4, [2, 2]).u).toBeCloseTo(uv.u, 12);
	});

	it("1枚の大きさが 0 以下・数でないときは、1 m として扱う（NaN・無限大を出さない）", () => {
		const uv = floorUv({ x: 2, z: 3 }, { x: 0, z: 0 }, [0, Number.NaN]);
		expect(uv).toEqual({ u: 2, v: 3 });
		expect(Number.isFinite(wallUv(1, 1, [-1, 0]).u)).toBe(true);
	});
});

describe("tintFactor - 色の寄せ（絵の平均色 × 材質の色 ＝ 代表色。線形の値で、成分ごと）", () => {
	const srgbToLinear = (c: number) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	const linear = (hex: string) =>
		[1, 3, 5].map((i) =>
			srgbToLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
		);

	it("平均色に掛けると、代表色（線形）になる", () => {
		const mean: [number, number, number] = [0.41, 0.41, 0.075];
		const factor = tintFactor(ROOM_COLORS.washitsu as string, mean);
		const target = linear(ROOM_COLORS.washitsu as string);
		factor.forEach((f, i) =>
			expect(f * (mean[i] as number)).toBeCloseTo(target[i] as number, 9),
		);
	});

	it("平均色が 0・負・数でないとき、色が数でないときも、NaN・無限大を出さない（上限で抑える）", () => {
		for (const mean of [
			[0, 0, 0],
			[-1, 0.5, Number.NaN],
			[Number.POSITIVE_INFINITY, 1e-12, 0.3],
		] as [number, number, number][]) {
			for (const f of tintFactor("#a07850", mean)) {
				expect(Number.isFinite(f)).toBe(true);
				expect(f).toBeGreaterThanOrEqual(0);
				expect(f).toBeLessThanOrEqual(8);
			}
		}
		for (const f of tintFactor("red", [0.5, 0.5, 0.5])) expect(f).toBe(1);
	});
});

describe("parseStageMaterials - 素材の検証（鍵がそろっていなければ使わない）", () => {
	const entry = { tile: [1, 1], mean: [0.3, 0.2, 0.1] };
	const all = Object.fromEntries(
		STAGE_MATERIAL_KEYS.map((key) => [key, entry]),
	);

	it("すべての鍵があれば読む", () => {
		const parsed = parseStageMaterials({
			[STAGE_MATERIAL_EXTRAS_KEY]: { version: 1, materials: all },
		});
		expect(Object.keys(parsed ?? {}).sort()).toEqual(
			[...STAGE_MATERIAL_KEYS].sort(),
		);
		expect(parsed?.tatami).toEqual({ tile: [1, 1], mean: [0.3, 0.2, 0.1] });
	});

	it("鍵が足りない・形が違う・大きさが 0 以下・平均色が範囲の外なら null", () => {
		const { tatami: _tatami, ...missing } = all;
		for (const bad of [
			null,
			{},
			{ [STAGE_MATERIAL_EXTRAS_KEY]: { version: 2, materials: all } },
			{ [STAGE_MATERIAL_EXTRAS_KEY]: { version: 1, materials: missing } },
			{
				[STAGE_MATERIAL_EXTRAS_KEY]: {
					version: 1,
					materials: {
						...all,
						tatami: { tile: [0, 1], mean: [0.3, 0.2, 0.1] },
					},
				},
			},
			{
				[STAGE_MATERIAL_EXTRAS_KEY]: {
					version: 1,
					materials: {
						...all,
						tatami: { tile: [1, 1], mean: [1.5, 0.2, 0.1] },
					},
				},
			},
		]) {
			expect(parseStageMaterials(bad)).toBeNull();
		}
	});
});

describe("壁の掛ける色と、明るさ（CIELAB の L）", () => {
	it("lightness: 線形の色の CIELAB の L（黒 0、白 100、sRGB の中間の灰色は約 53）", () => {
		expect(lightness([0, 0, 0])).toBeCloseTo(0, 6);
		expect(lightness([1, 1, 1])).toBeCloseTo(100, 4);
		// #777777 の線形の値は約 0.184。
		expect(lightness([0.184, 0.184, 0.184])).toBeCloseTo(50.0, 0);
		expect(Number.isFinite(lightness([Number.NaN, -1, 2]))).toBe(true);
	});

	it("multiplyFactor: 掛ける色の線形の値。読めない色は 1（掛けない）", () => {
		expect(multiplyFactor("#ffffff")).toEqual([1, 1, 1]);
		expect(multiplyFactor("#000000")).toEqual([0, 0, 0]);
		expect(multiplyFactor("red")).toEqual([1, 1, 1]);
		const [r] = multiplyFactor("#777777");
		expect(r).toBeCloseTo(0.184, 3);
	});

	it("shadedMean: 壁の平均色 = 絵の平均色 × 掛ける色（線形の値で、成分ごと）", () => {
		const mean: [number, number, number] = [0.4, 0.2, 0.1];
		const [r, g, b] = shadedMean(mean, "#777777");
		expect(r).toBeCloseTo(0.4 * 0.184, 3);
		expect(g).toBeCloseTo(0.2 * 0.184, 3);
		expect(b).toBeCloseTo(0.1 * 0.184, 3);
	});

	it("CEILING_MULTIPLY も、暗くする灰色", () => {
		expect(CEILING_MULTIPLY).toMatch(/^#([0-9a-f]{2})\1\1$/);
		expect(multiplyFactor(CEILING_MULTIPLY)[0]).toBeLessThan(1);
	});

	it("WALL_MULTIPLY は、暗くする灰色（成分がそろい、木の色味を変えない）", () => {
		expect(WALL_MULTIPLY).toMatch(/^#([0-9a-f]{2})\1\1$/);
		const [r] = multiplyFactor(WALL_MULTIPLY);
		expect(r).toBeLessThan(1);
	});
});
