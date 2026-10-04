/**
 * glb の中身を調べて JSON に書き出す（Node だけで動く。three.js などは使わない）。
 *
 * 使い方:
 *   node tools/inspect_glb.mjs assets-src/house/hiraya.glb assets-src/house/hiraya-scene.json
 *
 * glb の JSON 部分（glTF）を読み、次を書き出す。
 * - ノード名と親子関係、各ノードの位置（ローカルとワールド）
 * - メッシュごとの寸法（m。頂点位置の最小・最大から。ローカルとワールドの外接箱）
 * - マテリアルの数、テクスチャの数と、画像の大きさ（幅・高さ px と、バイト数）
 * 標準出力には要約（全体の寸法、ノードの総数、屋根・天井・壁・床・襖・障子に見える名前）を出す。
 * glb が複数のシーンを持つとき（Blender の別シーンを含めて書き出した場合など）は、既定の
 * シーン（gltf.scene）から辿れるノードだけで寸法と要約を出す。JSON には全ノードを載せる。
 * 入力の glb は読むだけで、変更しない。
 */

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
	console.error("使い方: node tools/inspect_glb.mjs <入力.glb> <出力.json>");
	process.exit(2);
}

// --- glb を読む -----------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

function readGlb(path) {
	const buffer = readFileSync(path);
	if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
		throw new Error(`glb ではありません: ${path}`);
	}
	let offset = 12;
	let json = null;
	let bin = null;
	while (offset < buffer.length) {
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		const body = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
		if (type === CHUNK_BIN) bin = body;
		offset += 8 + length;
	}
	if (json === null) throw new Error("JSON チャンクがありません");
	return { gltf: json, bin, bytes: buffer.length };
}

// --- 行列（列優先の 4x4。glTF と同じ並び） ------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

function compose(translation, rotation, scale) {
	const [x, y, z, w] = rotation;
	const [sx, sy, sz] = scale;
	return [
		(1 - 2 * (y * y + z * z)) * sx,
		2 * (x * y + z * w) * sx,
		2 * (x * z - y * w) * sx,
		0,
		2 * (x * y - z * w) * sy,
		(1 - 2 * (x * x + z * z)) * sy,
		2 * (y * z + x * w) * sy,
		0,
		2 * (x * z + y * w) * sz,
		2 * (y * z - x * w) * sz,
		(1 - 2 * (x * x + y * y)) * sz,
		0,
		translation[0],
		translation[1],
		translation[2],
		1,
	];
}

function localMatrix(node) {
	if (node.matrix !== undefined) return node.matrix;
	return compose(
		node.translation ?? [0, 0, 0],
		node.rotation ?? [0, 0, 0, 1],
		node.scale ?? [1, 1, 1],
	);
}

function transform(m, [x, y, z]) {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

// --- 外接箱 --------------------------------------------------------------

function emptyBox() {
	return {
		min: [
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
		],
		max: [
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		],
	};
}

function grow(box, point) {
	for (let i = 0; i < 3; i++) {
		box.min[i] = Math.min(box.min[i], point[i]);
		box.max[i] = Math.max(box.max[i], point[i]);
	}
}

function isEmpty(box) {
	return box.min[0] > box.max[0];
}

function corners(box) {
	const out = [];
	for (const x of [box.min[0], box.max[0]])
		for (const y of [box.min[1], box.max[1]])
			for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
	return out;
}

function round(value) {
	return Math.round(value * 1000) / 1000;
}

function describeBox(box) {
	if (isEmpty(box)) return null;
	return {
		min: box.min.map(round),
		max: box.max.map(round),
		size: box.max.map((v, i) => round(v - box.min[i])),
	};
}

// --- 画像の大きさ ---------------------------------------------------------

function imageSize(bytes) {
	// PNG: 先頭の IHDR に幅と高さ。
	if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
		return {
			format: "png",
			width: bytes.readUInt32BE(16),
			height: bytes.readUInt32BE(20),
		};
	}
	// JPEG: SOF マーカーに高さと幅。
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) break;
			const marker = bytes[offset + 1];
			const length = bytes.readUInt16BE(offset + 2);
			const isSof =
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc;
			if (isSof) {
				return {
					format: "jpeg",
					width: bytes.readUInt16BE(offset + 7),
					height: bytes.readUInt16BE(offset + 5),
				};
			}
			offset += 2 + length;
		}
		return { format: "jpeg", width: null, height: null };
	}
	return { format: "unknown", width: null, height: null };
}

// --- 調べる ----------------------------------------------------------------

const { gltf, bin, bytes } = readGlb(input);
const nodes = gltf.nodes ?? [];
const meshes = gltf.meshes ?? [];
const accessors = gltf.accessors ?? [];

// メッシュごとの、ローカルの外接箱（POSITION の min / max から）。
const meshBoxes = meshes.map((mesh) => {
	const box = emptyBox();
	for (const primitive of mesh.primitives ?? []) {
		const accessor = accessors[primitive.attributes?.POSITION];
		if (accessor?.min && accessor?.max) {
			grow(box, accessor.min);
			grow(box, accessor.max);
		}
	}
	return box;
});

// 親を引けるようにする。
const parentOf = new Map();
nodes.forEach((node, index) => {
	for (const child of node.children ?? []) parentOf.set(child, index);
});

// ワールド行列を、根から順に求める。
const world = new Array(nodes.length).fill(null);
const inDefaultScene = new Set();
const visit = (index, parentMatrix) => {
	inDefaultScene.add(index);
	world[index] = multiply(parentMatrix, localMatrix(nodes[index]));
	for (const child of nodes[index].children ?? []) visit(child, world[index]);
};
const sceneIndex = gltf.scene ?? 0;
const roots =
	gltf.scenes?.[sceneIndex]?.nodes ??
	nodes.map((_, i) => i).filter((i) => !parentOf.has(i));
for (const root of roots) visit(root, IDENTITY);

const total = emptyBox();
const nodeReports = nodes.map((node, index) => {
	const matrix = world[index] ?? localMatrix(node);
	const report = {
		index,
		name: node.name ?? `(node ${index})`,
		parent: parentOf.has(index) ? parentOf.get(index) : null,
		parentName: parentOf.has(index)
			? (nodes[parentOf.get(index)].name ?? null)
			: null,
		children: node.children ?? [],
		localPosition: (
			node.translation ?? (node.matrix ? node.matrix.slice(12, 15) : [0, 0, 0])
		).map(round),
		worldPosition: transform(matrix, [0, 0, 0]).map(round),
		inDefaultScene: inDefaultScene.has(index),
	};
	if (node.mesh !== undefined) {
		const local = meshBoxes[node.mesh];
		const worldBox = emptyBox();
		if (!isEmpty(local))
			for (const corner of corners(local))
				grow(worldBox, transform(matrix, corner));
		if (!isEmpty(worldBox) && inDefaultScene.has(index)) {
			grow(total, worldBox.min);
			grow(total, worldBox.max);
		}
		report.mesh = {
			index: node.mesh,
			name: meshes[node.mesh]?.name ?? null,
			primitives: meshes[node.mesh]?.primitives?.length ?? 0,
			localBox: describeBox(local),
			worldBox: describeBox(worldBox),
		};
	}
	return report;
});

const images = (gltf.images ?? []).map((image, index) => {
	let size = { format: image.mimeType ?? "unknown", width: null, height: null };
	let byteLength = null;
	if (image.bufferView !== undefined && bin !== null) {
		const view = gltf.bufferViews[image.bufferView];
		const start = view.byteOffset ?? 0;
		const slice = bin.subarray(start, start + view.byteLength);
		size = imageSize(slice);
		byteLength = view.byteLength;
	}
	return {
		index,
		name: image.name ?? null,
		uri: image.uri ?? null,
		mimeType: image.mimeType ?? null,
		...size,
		byteLength,
	};
});

const result = {
	source: input,
	fileBytes: bytes,
	generator: gltf.asset?.generator ?? null,
	defaultScene: gltf.scenes?.[sceneIndex]?.name ?? null,
	scenes: (gltf.scenes ?? []).map((scene, index) => ({
		index,
		name: scene.name ?? null,
		roots: (scene.nodes ?? []).length,
	})),
	counts: {
		nodes: nodes.length,
		nodesInDefaultScene: inDefaultScene.size,
		meshes: meshes.length,
		materials: (gltf.materials ?? []).length,
		textures: (gltf.textures ?? []).length,
		images: images.length,
	},
	bounds: describeBox(total),
	nodes: nodeReports,
	materials: (gltf.materials ?? []).map((material, index) => ({
		index,
		name: material.name ?? null,
	})),
	textures: (gltf.textures ?? []).map((texture, index) => ({
		index,
		source: texture.source ?? null,
	})),
	images,
};

writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);

// --- 要約 ----------------------------------------------------------------

/**
 * 名前から見分ける部位（日本語・ローマ字・英語）。床は床の間（飾りの区画）を除く。
 * 襖という名前の部品が無い素材もあるので、引違い戸（障子・玄関を除く）を襖の候補として出す。
 */
const PARTS = [
	["屋根", (name) => /屋根|yane|roof/i.test(name)],
	["天井", (name) => /天井|tenjo|tenjou|ceil/i.test(name)],
	["壁", (name) => /壁|kabe|wall/i.test(name)],
	[
		"床",
		(name) => /床|yuka|floor|畳|tatami/i.test(name) && !/床の間/.test(name),
	],
	["襖", (name) => /襖|fusuma/i.test(name)],
	[
		"襖の候補（引違い戸）",
		(name) => /引違い戸/.test(name) && !/障子|玄関/.test(name),
	],
	["障子", (name) => /障子|shoji|shouji/i.test(name)],
];

/** 連番の付いた同じ部品をまとめる（末尾の -001 や .002 を外した名前で数える）。 */
function grouped(names) {
	const counts = new Map();
	for (const name of names) {
		const key = name.replace(/([-.]\d+)+$/, "");
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts].map(([key, count]) =>
		count > 1 ? `${key} x${count}` : key,
	);
}

const sceneNodes = nodeReports.filter((n) => n.inDefaultScene);
console.log(`ファイル: ${input}（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
console.log(
	`シーン: ${result.scenes.map((sc) => `${sc.name}（根 ${sc.roots}）`).join(", ")}。既定: ${result.defaultScene}`,
);
console.log(
	`ノード: 全体 ${result.counts.nodes}（既定のシーン ${result.counts.nodesInDefaultScene}）、メッシュ: ${result.counts.meshes}、マテリアル: ${result.counts.materials}、テクスチャ: ${result.counts.textures}、画像: ${result.counts.images}`,
);
if (result.bounds) {
	const [x, y, z] = result.bounds.size;
	console.log(
		`全体の寸法（m、Y が上、既定のシーン）: 幅 x ${x} / 高さ y ${y} / 奥行き z ${z}`,
	);
}
for (const [label, test] of PARTS) {
	const names = sceneNodes.filter((n) => test(n.name)).map((n) => n.name);
	console.log(`${label}（${names.length}）: ${grouped(names).join(", ")}`);
}
console.log(`書き出し: ${output}`);
