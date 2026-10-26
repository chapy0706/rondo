/**
 * ランダム間取りの和室に置く小物のキット（room-props / issue-72 第 1 段階）を、平屋の元の glb から作る。
 *
 * 使い方:
 *   node tools/room_props.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house
 *
 * 出力: room-props-{512,1024}.glb（中身は同じ。テクスチャの長辺は 512。manifest は key と品質で引くため、
 * 両方に置く）。出したら tools/make_manifest.mjs で manifest を作り直す。
 *
 * 中身:
 * - 小物ごとに 1 つのノード（名前は "room-prop:<種類>"。材質ごとのプリミティブを持つ 1 つのメッシュ）。
 *   足もとの中心を原点にそろえ、回転は形に焼き込む（ノードは回転を持たない）。ノードの extras に、
 *   幅（x）・奥行き（z）・高さ（メートル）と、三角形の数を入れる
 * - scene の extras の rondoRoomProps に { version: 1, props: { 種類: { width, depth, height, triangles,
 *   source } } } を入れる（クライアントの roomPropKit.ts が検証して使う）
 * - 小物（種類 ← 元の根のノード）: chabudai ← ちゃぶ台-002 W90D90H35、zaisu ← 座椅子-001、tsubo ← 壺-001、
 *   yunomi ← 湯呑み(軽)-001。急須と座卓和風は入れない（急須は三角形が多すぎ、座卓は寝た体を上から覆う）
 * - 三角形は meshopt で減らす（小物ごとの上限は roomProps.ts の PROP_TRIANGLES と同じ）
 * - 絵は、色の絵だけを残し（法線・粗さの絵は外す）、512 の webp にする。形は meshopt で圧縮する
 * - 第 1 段階の上限（高さ 0.55 m 以下、上から見た長い辺 1.0 m 以下 / roomProps.ts）を超える小物があれば、
 *   何も書かずに止まる（終了コード 2）
 *
 * キットは平屋の派生（平屋の規約は、組み込みを許し、素材の二次配布を禁じる / ADR 0040）。入力は読むだけで、
 * 変更しない。リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）。
 */

import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
	dedup,
	meshopt,
	prune,
	simplifyPrimitive,
	textureCompress,
	weldPrimitive,
} from "@gltf-transform/functions";
import {
	MeshoptDecoder,
	MeshoptEncoder,
	MeshoptSimplifier,
} from "meshoptimizer";
import sharp from "sharp";

/** 小物（種類 → 元の根のノードの名前と、三角形の数の上限。roomProps.ts の PROP_TRIANGLES と同じ）。 */
const PROPS = [
	{ kind: "chabudai", root: "ちゃぶ台-002 W90D90H35", triangles: 700 },
	{ kind: "zaisu", root: "座椅子-001", triangles: 700 },
	{ kind: "tsubo", root: "壺-001", triangles: 700 },
	{ kind: "yunomi", root: "湯呑み(軽)-001", triangles: 250 },
];
/** 第 1 段階の上限（roomProps.ts の PROP_MAX_HEIGHT・PROP_MAX_SPAN と同じ）。 */
const MAX_HEIGHT = 0.55;
const MAX_SPAN = 1.0;
const SIZE = 512;
const QUALITIES = [512, 1024];

const [inputArg, outputArg] = process.argv.slice(2);
if (inputArg === undefined || outputArg === undefined) {
	console.error(
		"使い方: node tools/room_props.mjs <平屋の元の glb> <出力先のフォルダ>",
	);
	process.exit(2);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(outputArg);
const inRepo = output === repo || output.startsWith(repo + sep);
if (inRepo && !output.startsWith(join(repo, "assets-src") + sep)) {
	console.error(
		`停止: リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）: ${output}`,
	);
	process.exit(2);
}

await Promise.all([
	MeshoptDecoder.ready,
	MeshoptEncoder.ready,
	MeshoptSimplifier.ready,
]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		sharp,
		"meshopt.decoder": MeshoptDecoder,
		"meshopt.encoder": MeshoptEncoder,
	});
const source = await io.read(resolve(inputArg));
const sourceScene =
	source.getRoot().getDefaultScene() ?? source.getRoot().listScenes()[0];

/** 列優先の 4x4 の行列 m で、点 p を写す。 */
const apply = (m, p) => [
	m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
	m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
	m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
/** 向き（法線）を写す（拡大は一様の前提。長さを 1 に戻す）。 */
const applyDirection = (m, d) => {
	const v = [
		m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
		m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
		m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
	];
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return v.map((x) => x / length);
};
const round3 = (v) => Math.round(v * 1000) / 1000;

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene("room-props");
out.getRoot().setDefaultScene(scene);
/** 元の材質 → キットの材質（同じ材質は 1 つにまとめる）。 */
const materials = new Map();

function copyMaterial(material) {
	if (material === null) return null;
	const found = materials.get(material);
	if (found !== undefined) return found;
	const copy = out
		.createMaterial(material.getName())
		.setBaseColorFactor(material.getBaseColorFactor())
		.setMetallicFactor(material.getMetallicFactor())
		.setRoughnessFactor(material.getRoughnessFactor())
		.setAlphaMode(material.getAlphaMode())
		.setDoubleSided(material.getDoubleSided());
	const texture = material.getBaseColorTexture();
	if (texture !== null) {
		const info = material.getBaseColorTextureInfo();
		if (info?.getExtension("KHR_texture_transform") != null) {
			console.warn(
				`注意: ${material.getName()} の絵の変換（KHR_texture_transform）は写さない`,
			);
		}
		copy.setBaseColorTexture(
			out
				.createTexture(texture.getName())
				.setImage(texture.getImage())
				.setMimeType(texture.getMimeType()),
		);
	}
	materials.set(material, copy);
	return copy;
}

/** 元の根の下の、メッシュを持つノードのプリミティブを、ワールドの座標で集める（材質ごと）。 */
function collect(root) {
	const groups = new Map();
	root.traverse((node) => {
		const mesh = node.getMesh();
		if (mesh === null) return;
		const world = node.getWorldMatrix();
		for (const primitive of mesh.listPrimitives()) {
			const material = primitive.getMaterial();
			const group = groups.get(material) ?? {
				positions: [],
				normals: [],
				uvs: [],
				indices: [],
			};
			const position = primitive.getAttribute("POSITION");
			const normal = primitive.getAttribute("NORMAL");
			const uv = primitive.getAttribute("TEXCOORD_0");
			const base = group.positions.length;
			for (let i = 0; i < position.getCount(); i++) {
				group.positions.push(apply(world, position.getElement(i, [])));
				group.normals.push(
					normal === null
						? [0, 1, 0]
						: applyDirection(world, normal.getElement(i, [])),
				);
				group.uvs.push(uv === null ? [0, 0] : uv.getElement(i, []));
			}
			const indices = primitive.getIndices();
			const count = indices === null ? position.getCount() : indices.getCount();
			for (let i = 0; i < count; i++) {
				group.indices.push(
					base + (indices === null ? i : indices.getScalar(i)),
				);
			}
			groups.set(material, group);
		}
	});
	return groups;
}

const triangleCount = (mesh) =>
	mesh
		.listPrimitives()
		.reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3, 0);

const summary = {};
for (const prop of PROPS) {
	const root = sourceScene
		.listChildren()
		.find((node) => node.getName() === prop.root);
	if (root === undefined) {
		console.error(`停止: 元の glb に小物が無い: ${prop.root}`);
		process.exit(2);
	}
	const groups = collect(root);
	const all = [...groups.values()].flatMap((g) => g.positions);
	const lo = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k])));
	const hi = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
	// 足もとの中心を原点にする。
	const offset = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
	const size = {
		width: round3(hi[0] - lo[0]),
		depth: round3(hi[2] - lo[2]),
		height: round3(hi[1] - lo[1]),
	};
	if (size.height > MAX_HEIGHT || Math.max(size.width, size.depth) > MAX_SPAN) {
		console.error(
			`停止: ${prop.kind} が第 1 段階の上限（高さ ${MAX_HEIGHT} m・長い辺 ${MAX_SPAN} m）を超える: ${JSON.stringify(size)}`,
		);
		process.exit(2);
	}

	const mesh = out.createMesh(prop.kind);
	for (const [material, group] of groups) {
		const accessor = (type, array) =>
			out.createAccessor().setType(type).setArray(array).setBuffer(buffer);
		const primitive = out
			.createPrimitive()
			.setAttribute(
				"POSITION",
				accessor(
					"VEC3",
					new Float32Array(
						group.positions.flatMap((p) => [
							p[0] - offset[0],
							p[1] - offset[1],
							p[2] - offset[2],
						]),
					),
				),
			)
			.setAttribute(
				"NORMAL",
				accessor("VEC3", new Float32Array(group.normals.flat())),
			)
			.setAttribute(
				"TEXCOORD_0",
				accessor("VEC2", new Float32Array(group.uvs.flat())),
			)
			.setIndices(accessor("SCALAR", new Uint32Array(group.indices)))
			.setMaterial(copyMaterial(material));
		mesh.addPrimitive(primitive);
	}

	// 三角形を、上限まで減らす（誤差の許しを少しずつ広げる）。
	const before = triangleCount(mesh);
	for (const primitive of mesh.listPrimitives()) weldPrimitive(primitive);
	let ratio = Math.min(1, prop.triangles / Math.max(before, 1));
	for (
		let step = 0;
		step < 12 && triangleCount(mesh) > prop.triangles;
		step++
	) {
		for (const primitive of mesh.listPrimitives()) {
			simplifyPrimitive(primitive, {
				simplifier: MeshoptSimplifier,
				ratio,
				error: 0.002 * 2 ** step,
			});
		}
		ratio *= 0.85;
	}
	const triangles = triangleCount(mesh);
	if (triangles > prop.triangles) {
		console.error(
			`停止: ${prop.kind} の三角形が上限まで減らない（${triangles} > ${prop.triangles}）`,
		);
		process.exit(2);
	}

	scene.addChild(
		out
			.createNode(`room-prop:${prop.kind}`)
			.setMesh(mesh)
			.setExtras({ ...size, triangles }),
	);
	summary[prop.kind] = { ...size, triangles, before, source: prop.root };
}

scene.setExtras({ rondoRoomProps: { version: 1, props: summary } });

await out.transform(
	prune(),
	dedup(),
	textureCompress({
		encoder: sharp,
		targetFormat: "webp",
		resize: [SIZE, SIZE],
	}),
	prune(),
	meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

mkdirSync(output, { recursive: true });
const written = [];
for (const quality of QUALITIES) {
	const path = join(output, `room-props-${quality}.glb`);
	await io.write(path, out);
	written.push(`${path}（${statSync(path).size} バイト）`);
}

for (const [kind, info] of Object.entries(summary)) {
	console.log(
		`${kind}: 幅 ${info.width}・奥行き ${info.depth}・高さ ${info.height} m、三角形 ${info.before} → ${info.triangles}（${info.source}）`,
	);
}
console.log(`書いた: ${written.join("、")}`);
