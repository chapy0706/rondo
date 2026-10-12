/**
 * 材質の素材（stage-materials）の検査。手元に素材（assets-src/delivery）があるときだけ確かめる。
 * 素材のファイルはリポジトリに入れないので、無ければ飛ばす（make verify は素材に頼らない）。
 * glb の JSON の部分を直接読む（three の GLTFLoader は、Node では webp の絵を読めないため）。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOOR_COLOR, ROOM_COLORS } from "./palette";
import {
	CEILING_MULTIPLY,
	FLOOR_MATERIALS,
	type PlaceKind,
	STAGE_MATERIAL_EXTRAS_KEY,
	STAGE_MATERIAL_KEYS,
	WALL_MULTIPLY,
	lightness,
	parseStageMaterials,
	shadedMean,
	tintFactor,
} from "./stageMaterials";

const file = new URL(
	"../../../../../assets-src/delivery/v2/house/stage-materials-512.glb",
	import.meta.url,
);
const present = existsSync(file);

/** 大きさの目標（バイト。1 MB 前後）。 */
const TARGET_BYTES = 1024 * 1024;
/** 寄せたあとの色差（CIELAB の ΔE）の上限。 */
const MAX_DELTA_E = 2;
/** 寄せたあと（絵の画素 × 倍率）に、1 を超える画素の割合の上限（白飛び）。 */
const MAX_CLIPPED = 0.02;
/** 壁（木の板張り）を、床のどの代表色よりも暗くする、明るさ L の差の下限。 */
const MIN_WALL_FLOOR_L = 15;
/** 襖の板と壁の、明るさ L の差の下限（見分けるため）。 */
const MIN_FUSUMA_WALL_L = 30;

interface GltfJson {
	scenes: { extras?: unknown }[];
	scene?: number;
	materials: {
		name: string;
		pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
	}[];
	meshes: { name: string }[];
	textures: {
		source?: number;
		extensions?: { EXT_texture_webp?: { source: number } };
	}[];
	images: { bufferView: number }[];
	bufferViews: { byteOffset?: number; byteLength: number }[];
	extensionsUsed?: string[];
}

/** glb の JSON の部分。 */
function gltfJson(path: URL): GltfJson {
	const data = readFileSync(path);
	const length = data.readUInt32LE(12);
	return JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
}

/** 材質の色の絵のバイト（glb のバイナリの部分から）。 */
function colorImage(path: URL, json: GltfJson, material: string): Buffer {
	const data = readFileSync(path);
	const jsonLength = data.readUInt32LE(12);
	const binStart = 20 + jsonLength + 8;
	const found = json.materials.find((m) => m.name === material);
	const textureIndex = found?.pbrMetallicRoughness?.baseColorTexture?.index;
	if (textureIndex === undefined) throw new Error(`${material} に色の絵が無い`);
	const texture = json.textures[textureIndex];
	const imageIndex =
		texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
	const view =
		json.bufferViews[json.images[imageIndex ?? -1]?.bufferView ?? -1];
	if (view === undefined) throw new Error(`${material} の絵が読めない`);
	const start = binStart + (view.byteOffset ?? 0);
	return data.subarray(start, start + view.byteLength);
}

const lin = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) =>
	c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
/** 線形の色 → CIELAB。 */
function lab(linear: readonly number[]): [number, number, number] {
	const [r = 0, g = 0, b = 0] = linear;
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const linearOf = (hex: string) =>
	[1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
const deltaE = (a: readonly number[], b: readonly number[]) => {
	const p = lab(a);
	const q = lab(b);
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** 場所の種類ごとの、寄せる代表色。 */
const TARGETS: Readonly<Record<PlaceKind, string>> = {
	washitsu: ROOM_COLORS.washitsu as string,
	oshiire: ROOM_COLORS.oshiire as string,
	room: FLOOR_COLOR,
	corridor: FLOOR_COLOR,
	engawa: FLOOR_COLOR,
	genkan: FLOOR_COLOR,
};

describe.skipIf(!present)(
	"材質の素材の検査（手元に素材があるときだけ）",
	() => {
		it("大きさは、目標（1 MB 前後）以内", () => {
			expect(statSync(file).size).toBeLessThanOrEqual(TARGET_BYTES);
		});

		it("鍵がそろい、材質ごとに四角いメッシュがあり、絵は webp", () => {
			const json = gltfJson(file);
			const scene = json.scenes[json.scene ?? 0];
			const info = parseStageMaterials(scene?.extras);
			expect(info).not.toBeNull();
			expect(json.materials.map((m) => m.name).sort()).toEqual(
				[...STAGE_MATERIAL_KEYS].sort(),
			);
			expect(json.meshes.map((m) => m.name).sort()).toEqual(
				STAGE_MATERIAL_KEYS.map((key) => `stage-material:${key}`).sort(),
			);
			expect(json.extensionsUsed).toContain("EXT_texture_webp");
			expect(
				STAGE_MATERIAL_EXTRAS_KEY in ((scene?.extras ?? {}) as object),
			).toBe(true);
		});

		it("床は、寄せたあとの平均色が、その場の代表色に近い（ΔE が 2 以内。和室の3種類も）", () => {
			const json = gltfJson(file);
			const info = parseStageMaterials(json.scenes[json.scene ?? 0]?.extras);
			if (info === null) throw new Error("読めない");
			const targets: [string, string, string][] = [
				...(Object.entries(TARGETS) as [PlaceKind, string][]).map(
					([kind, color]) =>
						[kind, FLOOR_MATERIALS[kind], color] as [string, string, string],
				),
				[
					"washitsu-oshiire",
					"tatami",
					ROOM_COLORS["washitsu-oshiire"] as string,
				],
				[
					"washitsu-kakejiku",
					"tatami",
					ROOM_COLORS["washitsu-kakejiku"] as string,
				],
			];
			for (const [place, material, color] of targets) {
				const mean = info[material as keyof typeof info].mean;
				const factor = tintFactor(color, mean);
				const tinted = mean.map((m, i) => Math.min(1, m * (factor[i] ?? 1)));
				expect(deltaE(tinted, linearOf(color)), place).toBeLessThan(
					MAX_DELTA_E,
				);
				// 参考: sRGB にしても数として正しい。
				for (const c of tinted) expect(Number.isFinite(toSrgb(c))).toBe(true);
			}
		});

		it("床は、寄せたあと（絵の画素 × 倍率）に 1 を超える画素（白飛び）が 2% 以下", async () => {
			const sharp = (await import("sharp")).default;
			const json = gltfJson(file);
			const info = parseStageMaterials(json.scenes[json.scene ?? 0]?.extras);
			if (info === null) throw new Error("読めない");
			const targets: [string, string, string][] = [
				...(Object.entries(TARGETS) as [PlaceKind, string][]).map(
					([kind, color]) =>
						[kind, FLOOR_MATERIALS[kind], color] as [string, string, string],
				),
				[
					"washitsu-oshiire",
					"tatami",
					ROOM_COLORS["washitsu-oshiire"] as string,
				],
				[
					"washitsu-kakejiku",
					"tatami",
					ROOM_COLORS["washitsu-kakejiku"] as string,
				],
			];
			const clipped: Record<string, number> = {};
			for (const [place, material, color] of targets) {
				const factor = tintFactor(
					color,
					info[material as keyof typeof info].mean,
				);
				const { data, info: raw } = await sharp(
					colorImage(file, json, material),
				)
					.removeAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true });
				let over = 0;
				for (let i = 0; i < data.length; i += raw.channels) {
					for (let c = 0; c < 3; c++) {
						if (lin((data[i + c] ?? 0) / 255) * (factor[c] ?? 1) > 1) {
							over += 1;
							break;
						}
					}
				}
				clipped[place] = over / (data.length / raw.channels);
			}
			for (const [place, fraction] of Object.entries(clipped)) {
				expect(fraction, place).toBeLessThanOrEqual(MAX_CLIPPED);
			}
		});

		it("壁（wood-dark × WALL_MULTIPLY）は、床のどの代表色よりも、明るさ L が 15 以上暗い", () => {
			const json = gltfJson(file);
			const info = parseStageMaterials(json.scenes[json.scene ?? 0]?.extras);
			if (info === null) throw new Error("読めない");
			const wall = lightness(shadedMean(info["wood-dark"].mean, WALL_MULTIPLY));
			const floors: [string, string][] = [
				...Object.entries(TARGETS),
				["washitsu-oshiire", ROOM_COLORS["washitsu-oshiire"] as string],
				["washitsu-kakejiku", ROOM_COLORS["washitsu-kakejiku"] as string],
			];
			for (const [place, color] of floors) {
				expect(lightness(linearOf(color)) - wall, place).toBeGreaterThanOrEqual(
					MIN_WALL_FLOOR_L,
				);
			}
		});

		it("襖の板の平均色と壁の平均色は、明るさ L が 30 以上違う（見分けられる）", () => {
			const json = gltfJson(file);
			const info = parseStageMaterials(json.scenes[json.scene ?? 0]?.extras);
			if (info === null) throw new Error("読めない");
			const wall = lightness(shadedMean(info["wood-dark"].mean, WALL_MULTIPLY));
			const fusuma = lightness(info.fusuma.mean);
			expect(fusuma - wall).toBeGreaterThanOrEqual(MIN_FUSUMA_WALL_L);
		});

		it("wood-dark の木目は、絵の縦（v）に走る（壁の UV で、木目が縦になる前提）", async () => {
			const sharp = (await import("sharp")).default;
			const json = gltfJson(file);
			const { data, info: raw } = await sharp(
				colorImage(file, json, "wood-dark"),
			)
				.greyscale()
				.raw()
				.toBuffer({ resolveWithObject: true });
			// 木目に沿う向きの隣どうしは、似た明るさ。横の隣より、縦の隣の差が小さい。
			let across = 0;
			let along = 0;
			for (let y = 0; y + 1 < raw.height; y++) {
				for (let x = 0; x + 1 < raw.width; x++) {
					const here = data[y * raw.width + x] ?? 0;
					across += Math.abs(here - (data[y * raw.width + x + 1] ?? 0));
					along += Math.abs(here - (data[(y + 1) * raw.width + x] ?? 0));
				}
			}
			expect(along).toBeLessThan(across * 0.8);
		});

		it("天井（wood-board × CEILING_MULTIPLY）は、床のどの代表色よりも暗い", () => {
			const json = gltfJson(file);
			const info = parseStageMaterials(json.scenes[json.scene ?? 0]?.extras);
			if (info === null) throw new Error("読めない");
			const ceiling = lightness(
				shadedMean(info["wood-board"].mean, CEILING_MULTIPLY),
			);
			const floors: [string, string][] = [
				...Object.entries(TARGETS),
				["washitsu-oshiire", ROOM_COLORS["washitsu-oshiire"] as string],
				["washitsu-kakejiku", ROOM_COLORS["washitsu-kakejiku"] as string],
			];
			for (const [place, color] of floors) {
				expect(ceiling, place).toBeLessThan(lightness(linearOf(color)));
			}
		});
	},
);
