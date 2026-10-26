/**
 * 小物のキット（room-props / issue-72）の検査。手元に素材（assets-src/delivery）があるときだけ確かめる。
 * 素材のファイルはリポジトリに入れないので、無ければ飛ばす（make verify は素材に頼らない）。
 * glb の JSON の部分を直接読む（three の GLTFLoader は、Node では webp の絵を読めないため）。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	PROP_EXTRAS_KEY,
	PROP_KINDS,
	PROP_KIT_MAX_BYTES,
	PROP_NODE_PREFIX,
	PROP_SIZES,
	PROP_TRIANGLES,
	lowProp,
} from "./roomProps";

const files = [512, 1024].map(
	(quality) =>
		new URL(
			`../../../../../assets-src/delivery/v2/house/room-props-${quality}.glb`,
			import.meta.url,
		),
);
const present = files.every((file) => existsSync(file));

/** 原点（足もとの中心）からのずれの許し（m。量子化の誤差を含む）。 */
const ORIGIN_TOLERANCE = 0.01;
/** 大きさの見込み（PROP_SIZES）を超えてよい量（m）。 */
const SIZE_TOLERANCE = 0.01;

interface GltfJson {
	scenes: { extras?: Record<string, unknown> }[];
	scene?: number;
	nodes: {
		name?: string;
		mesh?: number;
		children?: number[];
		translation?: number[];
		rotation?: number[];
		scale?: number[];
		extras?: Record<string, unknown>;
	}[];
	meshes: {
		primitives: {
			attributes: Record<string, number>;
			indices?: number;
			material?: number;
		}[];
	}[];
	accessors: {
		count: number;
		componentType: number;
		normalized?: boolean;
		min?: number[];
		max?: number[];
	}[];
	extensionsUsed?: string[];
}

function gltfJson(path: URL): GltfJson {
	const data = readFileSync(path);
	const length = data.readUInt32LE(12);
	return JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
}

/** 正規化された整数（量子化 / KHR_mesh_quantization）の、元の値（-1〜1 か 0〜1）への戻し方。 */
const NORMALIZED_MAX: Readonly<Record<number, number>> = {
	5120: 127,
	5121: 255,
	5122: 32767,
	5123: 65535,
};

/** ノードの箱（ノードの位置と拡大 × 頂点の位置の最小・最大。回転は持たない前提）。 */
function nodeBox(json: GltfJson, index: number) {
	const node = json.nodes[index];
	if (node?.mesh === undefined) throw new Error("メッシュが無い");
	const t = node.translation ?? [0, 0, 0];
	const s = node.scale ?? [1, 1, 1];
	const lo = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const hi = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	let triangles = 0;
	for (const primitive of json.meshes[node.mesh]?.primitives ?? []) {
		const position = json.accessors[primitive.attributes.POSITION as number];
		if (position?.min === undefined || position.max === undefined) {
			throw new Error("位置の最小・最大が無い");
		}
		const unit =
			position.normalized === true
				? (NORMALIZED_MAX[position.componentType] ?? 1)
				: 1;
		for (let k = 0; k < 3; k++) {
			const a =
				(t[k] as number) +
				((s[k] as number) * (position.min[k] as number)) / unit;
			const b =
				(t[k] as number) +
				((s[k] as number) * (position.max[k] as number)) / unit;
			lo[k] = Math.min(lo[k] as number, a, b);
			hi[k] = Math.max(hi[k] as number, a, b);
		}
		const count =
			primitive.indices === undefined
				? position.count
				: (json.accessors[primitive.indices]?.count ?? 0);
		triangles += count / 3;
	}
	return { lo, hi, triangles };
}

describe.skipIf(!present)("小物のキット（room-props / issue-72）", () => {
	for (const file of files) {
		const name = file.pathname.split("/").at(-1) ?? "";
		const json = present ? gltfJson(file) : null;
		const nodes = () => {
			if (json === null) throw new Error("無い");
			return new Map(
				json.nodes.flatMap((node, index) =>
					node.name?.startsWith(PROP_NODE_PREFIX) === true
						? [[node.name.slice(PROP_NODE_PREFIX.length), index] as const]
						: [],
				),
			);
		};

		it(`${name}: 小物の名前は、決めた 4 種だけ`, () => {
			expect([...nodes().keys()].sort()).toEqual([...PROP_KINDS].sort());
		});

		it(`${name}: 原点は足もとの中心。高さと上から見た長い辺は、第 1 段階の上限以下`, () => {
			for (const kind of PROP_KINDS) {
				const index = nodes().get(kind);
				if (index === undefined || json === null) throw new Error(kind);
				expect(json.nodes[index]?.rotation, kind).toBeUndefined();
				const { lo, hi } = nodeBox(json, index);
				const [x0, y0, z0] = lo as [number, number, number];
				const [x1, y1, z1] = hi as [number, number, number];
				expect(Math.abs(y0), `${kind} の足もと`).toBeLessThan(ORIGIN_TOLERANCE);
				expect(Math.abs((x0 + x1) / 2), `${kind} の x の中心`).toBeLessThan(
					ORIGIN_TOLERANCE,
				);
				expect(Math.abs((z0 + z1) / 2), `${kind} の z の中心`).toBeLessThan(
					ORIGIN_TOLERANCE,
				);
				const size = { width: x1 - x0, depth: z1 - z0, height: y1 - y0 };
				expect(lowProp(size), kind).toBe(true);
				const expected = PROP_SIZES[kind];
				expect(size.width, kind).toBeLessThanOrEqual(
					expected.width + SIZE_TOLERANCE,
				);
				expect(size.depth, kind).toBeLessThanOrEqual(
					expected.depth + SIZE_TOLERANCE,
				);
				expect(size.height, kind).toBeLessThanOrEqual(
					expected.height + SIZE_TOLERANCE,
				);
				// ノードの extras（幅・奥行き・高さ）は、形の大きさと合う。
				const extras = json.nodes[index]?.extras as
					| { width: number; depth: number; height: number }
					| undefined;
				expect(extras?.width).toBeCloseTo(size.width, 1);
				expect(extras?.depth).toBeCloseTo(size.depth, 1);
				expect(extras?.height).toBeCloseTo(size.height, 1);
			}
		});

		it(`${name}: 三角形の数は、小物ごとの上限以下`, () => {
			for (const kind of PROP_KINDS) {
				const index = nodes().get(kind);
				if (index === undefined || json === null) throw new Error(kind);
				expect(nodeBox(json, index).triangles, kind).toBeLessThanOrEqual(
					PROP_TRIANGLES[kind],
				);
			}
		});

		it(`${name}: 大きさは 2 MB 以下。meshopt で圧縮し、scene の extras に一覧がある`, () => {
			if (json === null) throw new Error("無い");
			expect(statSync(file).size).toBeLessThanOrEqual(PROP_KIT_MAX_BYTES);
			expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
			const scene = json.scenes[json.scene ?? 0];
			const extras = scene?.extras?.[PROP_EXTRAS_KEY] as
				| { version: number; props: Record<string, unknown> }
				| undefined;
			expect(extras?.version).toBe(1);
			expect(Object.keys(extras?.props ?? {}).sort()).toEqual(
				[...PROP_KINDS].sort(),
			);
		});
	}
});
