/**
 * ランダム間取りの箱を、平屋の材質で飾る（材質の素材 stage-materials）。three を使わない純粋な関数。
 *
 * - 場所 → 材質の鍵（placeKind・floorMaterial）: 床は地図の文字と部屋タイプで決める。対応表は
 *   FLOOR_MATERIALS の1か所（玄関を廊下と同じ板に替えるときは、ここの genkan を変える）
 * - 色の寄せ（tintFactor）: 床は、材質の色の値に「代表色 ÷ 絵の平均色」（線形の値で、成分ごと）を掛け、
 *   見た目の平均を、その場の代表色（palette.ts。サーバーと共有の見本と同じ値）にそろえる。スポイトで
 *   拾う色（絵の画素 × 材質の色）の平均も、代表色にそろう
 * - 壁は木の板張り（wood-dark）。絵に WALL_MULTIPLY（暗くする灰色）をそのまま掛け、床より暗くする。
 *   明るさの比べ方は CIELAB の L（lightness）
 * - UV（floorUv・wallUv）: 世界の座標を、1枚の絵の大きさ（メートル）で割る。壁は v が −高さで、
 *   木目が絵の縦に走る wood-dark では、壁の木目が縦になる。隣の箱との継ぎ目で模様が
 *   つながる。畳の絵（畳 2 枚ぶん、1.8 × 1.8 m）の原点は、部屋（スロット）の隅
 * - 素材の検証（parseStageMaterials）: 素材の glb の scene の extras を読み、鍵がそろっていなければ使わない
 */

import { z } from "zod";
import { placeColor } from "./palette";
import type { Cell, StageGrid } from "./stage";

/** 素材の材質の鍵（tools/stage_materials.mjs が作る）。 */
export const STAGE_MATERIAL_KEYS = [
	"tatami",
	"wood-board",
	"wood-dark",
	"fusuma",
	"doma",
] as const;
export type StageMaterialKey = (typeof STAGE_MATERIAL_KEYS)[number];

/** 場所の種類（床の材質を決める）。 */
export type PlaceKind =
	| "washitsu"
	| "oshiire"
	| "room"
	| "corridor"
	| "engawa"
	| "genkan";

/** 床の材質の対応表（1か所のデータ）。room は、和室・押し入れ以外の部屋タイプ。 */
export const FLOOR_MATERIALS: Readonly<Record<PlaceKind, StageMaterialKey>> = {
	washitsu: "tatami",
	oshiire: "wood-dark",
	room: "wood-board",
	corridor: "wood-board",
	engawa: "wood-dark",
	genkan: "doma",
};

/** 床以外の箱の材質（stageBoxes.ts の箱の種類ごと）。 */
export const SURFACE_MATERIALS = {
	wall: "wood-dark",
	fusuma: "fusuma",
	frame: "wood-dark",
	"fixed-door": "wood-dark",
	"entry-door": "wood-dark",
	ceiling: "wood-board",
	"dummy-fusuma": "fusuma",
	hikite: "wood-dark",
} as const satisfies Readonly<Record<string, StageMaterialKey>>;

/**
 * 壁の絵に掛ける色（線形の値で、成分ごとに掛ける。灰色なので木の色味は変えない）。壁の平均色
 * （wood-dark の平均色 × この色）の L を約 20 にし、床のどの代表色（いちばん暗い押し入れで L 約 37.5）
 * よりも 15 以上暗くする。リハーサルで変えるときは、素材の検査（stageMaterialsFile.test.ts）で確かめる。
 */
export const WALL_MULTIPLY = "#6c6c6c";

/**
 * 天井の絵（wood-board）に掛ける色（灰色）。天井の平均色の L を約 27.6 にし、床のどの代表色よりも暗く
 * （押し入れより約 10）、壁（約 20）よりは少し明るくする。
 */
export const CEILING_MULTIPLY = "#909090";

/** 色の寄せの、成分ごとの倍率の上限（極端な値で、絵が白く飛ばないように）。 */
const MAX_TINT = 8;

const WASHITSU = new Set(["washitsu", "washitsu-oshiire", "washitsu-kakejiku"]);

/** マスの場所の種類。歩けないマスは null。 */
export function placeKind(grid: StageGrid, cell: Cell): PlaceKind | null {
	const region = grid.regionAt(cell);
	if (region === null) return null;
	const room = grid.rooms[region];
	if (room !== undefined) {
		if (WASHITSU.has(room)) return "washitsu";
		return room === "oshiire" ? "oshiire" : "room";
	}
	switch (grid.charAt(cell)) {
		case "=":
			return "engawa";
		case "@":
			return "genkan";
		default:
			return "corridor";
	}
}

/** 部屋（スロット）ごとの隅（いちばん小さい x・z のマスの角。世界の座標）。 */
export function roomCorners(
	grid: StageGrid,
): Map<string, { readonly x: number; readonly z: number }> {
	const corners = new Map<string, { x: number; z: number }>();
	for (let z = 0; z < grid.depth; z++) {
		for (let x = 0; x < grid.width; x++) {
			const region = grid.regionAt({ x, z });
			if (region === null || grid.rooms[region] === undefined) continue;
			const corner = {
				x: grid.origin.x + x * grid.cellSize,
				z: grid.origin.z + z * grid.cellSize,
			};
			const known = corners.get(region);
			corners.set(
				region,
				known === undefined
					? corner
					: { x: Math.min(known.x, corner.x), z: Math.min(known.z, corner.z) },
			);
		}
	}
	return corners;
}

/**
 * マスの床の材質、寄せる色（その場の代表色）、絵の原点（畳は部屋の隅、ほかは世界の原点）。
 * corners は roomCorners の結果（省略すると、その場で求める）。歩けないマスは null。
 */
export function floorMaterial(
	grid: StageGrid,
	cell: Cell,
	corners: ReadonlyMap<
		string,
		{ readonly x: number; readonly z: number }
	> = roomCorners(grid),
): {
	readonly material: StageMaterialKey;
	readonly tint: string;
	readonly origin: { readonly x: number; readonly z: number };
} | null {
	const kind = placeKind(grid, cell);
	if (kind === null) return null;
	const material = FLOOR_MATERIALS[kind];
	const region = grid.regionAt(cell);
	const corner = region === null ? undefined : corners.get(region);
	return {
		material,
		tint: placeColor(grid, cell),
		origin:
			material === "tatami" && corner !== undefined ? corner : { x: 0, z: 0 },
	};
}

/** 1枚の大きさ（0 以下・数でないときは 1 m）。 */
const size = (value: number) =>
	Number.isFinite(value) && value > 0 ? value : 1;

/** 床の UV（原点からの x・z を、1枚の大きさで割る）。 */
export function floorUv(
	point: { readonly x: number; readonly z: number },
	origin: { readonly x: number; readonly z: number },
	tile: readonly [number, number],
): { readonly u: number; readonly v: number } {
	return {
		u: (point.x - origin.x) / size(tile[0]),
		v: (point.z - origin.z) / size(tile[1]),
	};
}

/**
 * 壁の UV（壁に沿う向きの位置 along と、高さ y を、1枚の大きさで割る）。v は −高さ: glTF の絵は上下を
 * 反転せずに読むので、絵の上の行が高い位置に来る。木目が絵の縦（v）に走る wood-dark では、木目が縦になる。
 */
export function wallUv(
	along: number,
	y: number,
	tile: readonly [number, number],
): { readonly u: number; readonly v: number } {
	return { u: along / size(tile[0]), v: -y / size(tile[1]) };
}

const srgbToLinear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** 掛ける色（"#rrggbb"）の線形の値。読めない色は [1, 1, 1]（掛けない）。 */
export function multiplyFactor(hex: string): [number, number, number] {
	if (!HEX.test(hex)) return [1, 1, 1];
	return [1, 3, 5].map((offset) =>
		srgbToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
	) as [number, number, number];
}

/** 掛けたあとの平均色（絵の平均色 × 掛ける色。線形の値）。 */
export function shadedMean(
	mean: readonly [number, number, number],
	hex: string,
): [number, number, number] {
	const factor = multiplyFactor(hex);
	return mean.map((m, i) => m * (factor[i] ?? 1)) as [number, number, number];
}

/** 線形の色の明るさ（CIELAB の L。0〜100）。数でない・範囲の外の成分は 0〜1 に収める。 */
export function lightness(linear: readonly number[]): number {
	const [r, g, b] = [0, 1, 2].map((i) => {
		const c = linear[i] ?? 0;
		return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
	}) as [number, number, number];
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 / 116) * y + 16 / 116;
	return 116 * f - 16;
}

/**
 * 色の寄せの倍率（線形の値で、成分ごと）。絵の平均色 mean（線形）に掛けると、target（"#rrggbb"）の
 * 線形の値になる。平均色が 0・負・数でないときや、色が "#rrggbb" でないときも、NaN・無限大を出さない
 * （0〜MAX_TINT。色が読めなければ 1）。
 */
export function tintFactor(
	target: string,
	mean: readonly [number, number, number],
): [number, number, number] {
	if (!HEX.test(target)) return [1, 1, 1];
	return [1, 3, 5].map((offset, i) => {
		const want = srgbToLinear(
			Number.parseInt(target.slice(offset, offset + 2), 16) / 255,
		);
		const have = mean[i] ?? 0;
		if (!Number.isFinite(have) || have <= 1e-6) return MAX_TINT;
		return Math.min(MAX_TINT, Math.max(0, want / have));
	}) as [number, number, number];
}

// --- 読む ---------------------------------------------------------------------------

/** scene の extras（userData）の中の名前。 */
export const STAGE_MATERIAL_EXTRAS_KEY = "rondoStageMaterials";

const unit = z.number().finite().min(0).max(1);
const entry = z.object({
	tile: z.tuple([
		z.number().finite().positive(),
		z.number().finite().positive(),
	]),
	mean: z.tuple([unit, unit, unit]),
});

const schema = z.object({
	[STAGE_MATERIAL_EXTRAS_KEY]: z.object({
		version: z.literal(1),
		materials: z.record(z.string(), entry),
	}),
});

export interface StageMaterialInfo {
	/** 1枚の絵の大きさ（メートル。横・縦）。 */
	readonly tile: readonly [number, number];
	/** 絵の平均色（線形の値）。 */
	readonly mean: readonly [number, number, number];
}

/** 素材の extras を検証して読む。鍵が足りない・形が違えば null（呼び出し側は色の箱のまま）。 */
export function parseStageMaterials(
	userData: unknown,
): Record<StageMaterialKey, StageMaterialInfo> | null {
	const result = schema.safeParse(userData);
	if (!result.success) return null;
	const materials = result.data[STAGE_MATERIAL_EXTRAS_KEY].materials;
	const out: Partial<Record<StageMaterialKey, StageMaterialInfo>> = {};
	for (const key of STAGE_MATERIAL_KEYS) {
		const found = materials[key];
		if (found === undefined) return null;
		out[key] = found;
	}
	return out as Record<StageMaterialKey, StageMaterialInfo>;
}
