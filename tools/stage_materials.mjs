/**
 * ランダム間取りの箱に貼る材質の素材（stage-materials）を、平屋の元の glb から作る。
 *
 * 使い方:
 *   node tools/stage_materials.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house
 *
 * 出力: stage-materials-{512,1024}.glb（中身は同じ。品質は 512。manifest は key と品質で引くため、
 * 両方に置く）。材質ごとに、小さな四角いメッシュ（ノードの名前は "stage-material:<鍵>"）を1枚付ける
 * （three の GLTFLoader は、メッシュから参照されない材質を読まないため）。scene の extras の
 * rondoStageMaterials に { version: 1, materials: { 鍵: { tile: [横, 縦]（1枚の絵のメートル）,
 * mean: [r, g, b]（色の絵の平均色。線形の値）, source } } } を入れる。クライアントは
 * apps/web/src/games/veryare/stageMaterials.ts の parseStageMaterials で検証して使う。
 * 出したら tools/make_manifest.mjs で manifest を作り直す。
 *
 * 材質（鍵 ← 元の材質）:
 *   tatami ← 畳-005 と畳縁-001 から作った、畳 2 枚ぶん（1.8 × 1.8 m）に縁を描いた絵
 *   wood-board ← 木目-002-004（板の間）、wood-dark ← 木目-002-003_001（縁側・押し入れ・鴨居）
 *   fusuma ← 襖-001、doma ← 壁-001-003（玄関の土間）
 *   障子（和紙）は入れない（ランダム間取りの箱に、障子は無い。障子は平屋の glb だけ）。壁紙も入れない
 *   （壁は木の板張りで、wood-dark を使う）
 * - 色の絵と法線の絵を、512 の webp にする（EXT_texture_webp）
 * - 1枚の大きさは、元の glb のその材質のメッシュの、UV と長さの比（辺ごとの中央値）から測る
 *   （畳は、作った絵の 1.8 m）
 *
 * 入力は読むだけで、変更しない。リポジトリの中では assets-src/ の下だけに書く。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const SIZE = 512;
const QUALITIES = [512, 1024];
/** 畳の絵: 1.8 × 1.8 m に畳 2 枚（各 0.9 × 1.8 m）。縁の幅（メートル）。 */
const TATAMI_TILE = 1.8;
const TATAMI_BORDER = 0.03;

const SOURCES = [
	{ key: "wood-board", pattern: /木目-002-004_001/ },
	{ key: "wood-dark", pattern: /木目-002-003_001/ },
	{ key: "fusuma", pattern: /husuma-001/ },
	{ key: "doma", pattern: /壁-001-003_001/ },
];
const TATAMI = /tatami-005/;
const TATAMI_EDGE = /Tatami_border-001/;

const [inputArg, outputArg] = process.argv.slice(2);
if (inputArg === undefined || outputArg === undefined) {
	console.error(
		"使い方: node tools/stage_materials.mjs <平屋の元の glb> <出力先のフォルダ>",
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

await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const source = await io.read(resolve(inputArg));
const materials = source.getRoot().listMaterials();
const find = (pattern) => {
	const found = materials.find((m) => pattern.test(m.getName()));
	if (found === undefined) {
		console.error(`停止: 元の glb に材質が無い: ${pattern}`);
		process.exit(2);
	}
	return found;
};

function apply(m, p) {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

/** 材質のメッシュの、UV と長さの比（辺ごと）の中央値 = 1枚の絵のメートル。 */
function tileOf(material) {
	const ratios = [];
	for (const node of source.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (mesh === null) continue;
		const world = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMaterial() !== material) continue;
			const pos = prim.getAttribute("POSITION");
			const uv = prim.getAttribute("TEXCOORD_0");
			if (uv === null) continue;
			const idx = prim.getIndices();
			const count = idx ? idx.getCount() : pos.getCount();
			const at = (i) => (idx ? idx.getScalar(i) : i);
			for (let i = 0; i + 2 < count && i < 6000; i += 3) {
				const a = at(i);
				const b = at(i + 1);
				const pa = apply(world, pos.getElement(a, []));
				const pb = apply(world, pos.getElement(b, []));
				const ua = uv.getElement(a, []);
				const ub = uv.getElement(b, []);
				const dw = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
				const du = Math.hypot(ua[0] - ub[0], ua[1] - ub[1]);
				if (dw >= 0.05 && du >= 1e-4) ratios.push(dw / du);
			}
		}
	}
	ratios.sort((p, q) => p - q);
	const median = ratios[Math.floor(ratios.length / 2)] ?? 1;
	return Math.round(median * 1000) / 1000;
}

const webp = (image) => image.webp({ quality: 85 }).toBuffer();
const square = (buffer) =>
	sharp(Buffer.from(buffer)).removeAlpha().resize(SIZE, SIZE, { fit: "fill" });

/** 色の絵（sRGB のバイト）の平均色（線形の値）。 */
async function meanLinear(buffer) {
	const { data, info } = await sharp(buffer)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const sum = [0, 0, 0];
	const lin = (c) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	for (let i = 0; i < data.length; i += info.channels) {
		for (let k = 0; k < 3; k++) sum[k] += lin(data[i + k]);
	}
	const n = data.length / info.channels;
	return sum.map((s) => Math.round((s / n) * 1e5) / 1e5);
}

const hex = (linear) =>
	`#${linear
		.map((c) => {
			const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
			return Math.round(Math.min(1, Math.max(0, v)) * 255)
				.toString(16)
				.padStart(2, "0");
		})
		.join("")}`;

/** 畳 2 枚ぶんの絵（色と法線）。畳の目を敷き詰め、各畳の長い辺に縁を描く。 */
async function tatamiImages() {
	const weave = find(TATAMI);
	const edge = find(TATAMI_EDGE);
	const weaveTile = tileOf(weave);
	const px = Math.max(8, Math.round((SIZE * weaveTile) / TATAMI_TILE));
	const border = Math.max(2, Math.round((SIZE * TATAMI_BORDER) / TATAMI_TILE));
	const half = Math.floor(border / 2);
	const tiled = async (texture) =>
		sharp({
			create: { width: SIZE, height: SIZE, channels: 3, background: "#808080" },
		})
			.composite([
				{
					input: await sharp(Buffer.from(texture.getImage()))
						.removeAlpha()
						.resize(px, px, { fit: "fill" })
						.toBuffer(),
					tile: true,
				},
			])
			.png()
			.toBuffer();
	// 縁の位置: 畳と畳の境（中央）と、絵の両端（繰り返すと、隣の絵の端とつながる）。
	const strips = [
		{ left: 0, width: border - half },
		{ left: SIZE / 2 - half, width: border },
		{ left: SIZE - half, width: half },
	].filter((s) => s.width > 0);
	const stripOf = async (input, width) =>
		sharp(input).resize(width, SIZE, { fit: "fill" }).removeAlpha().toBuffer();
	const edgeColor = await sharp(
		Buffer.from(edge.getBaseColorTexture().getImage()),
	)
		.removeAlpha()
		.png()
		.toBuffer();
	const flat = await sharp({
		create: {
			width: 1,
			height: 1,
			channels: 3,
			background: { r: 128, g: 128, b: 255 },
		},
	})
		.png()
		.toBuffer();
	const color = await sharp(await tiled(weave.getBaseColorTexture()))
		.composite(
			await Promise.all(
				strips.map(async (s) => ({
					input: await stripOf(edgeColor, s.width),
					left: s.left,
					top: 0,
				})),
			),
		)
		.png()
		.toBuffer();
	const normalSource = weave.getNormalTexture();
	const normal =
		normalSource === null
			? null
			: await sharp(await tiled(normalSource))
					.composite(
						await Promise.all(
							strips.map(async (s) => ({
								input: await stripOf(flat, s.width),
								left: s.left,
								top: 0,
							})),
						),
					)
					.png()
					.toBuffer();
	return { color, normal, weaveTile };
}

const out = new Document();
out.createExtension(EXTTextureWebP).setRequired(true);
const buffer = out.createBuffer();
const scene = out.createScene("stage-materials");
const info = {};
const report = [];

async function addMaterial(key, original, colorPng, normalPng, tile) {
	const colorWebp = await webp(sharp(colorPng));
	const color = out
		.createTexture(`${key}-color`)
		.setImage(colorWebp)
		.setMimeType("image/webp");
	const material = out
		.createMaterial(key)
		.setBaseColorTexture(color)
		.setBaseColorFactor([1, 1, 1, 1])
		.setMetallicFactor(original.getMetallicFactor())
		.setRoughnessFactor(original.getRoughnessFactor());
	let normalBytes = 0;
	if (normalPng !== null) {
		const normalWebp = await webp(sharp(normalPng));
		normalBytes = normalWebp.byteLength;
		material.setNormalTexture(
			out
				.createTexture(`${key}-normal`)
				.setImage(normalWebp)
				.setMimeType("image/webp"),
		);
	}
	// 小さな四角（1 × 1。UV 0〜1）。材質を読ませるためだけのもの。
	const positions = out
		.createAccessor()
		.setType("VEC3")
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]))
		.setBuffer(buffer);
	const uvs = out
		.createAccessor()
		.setType("VEC2")
		.setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
		.setBuffer(buffer);
	const normals = out
		.createAccessor()
		.setType("VEC3")
		.setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const indices = out
		.createAccessor()
		.setType("SCALAR")
		.setArray(new Uint16Array([0, 2, 1, 0, 3, 2]))
		.setBuffer(buffer);
	const primitive = out
		.createPrimitive()
		.setAttribute("POSITION", positions)
		.setAttribute("TEXCOORD_0", uvs)
		.setAttribute("NORMAL", normals)
		.setIndices(indices)
		.setMaterial(material);
	const mesh = out.createMesh(`stage-material:${key}`).addPrimitive(primitive);
	scene.addChild(out.createNode(`stage-material:${key}`).setMesh(mesh));
	const mean = await meanLinear(colorWebp);
	info[key] = { tile: [tile, tile], mean, source: original.getName() };
	report.push({
		key,
		tile,
		mean,
		colorBytes: colorWebp.byteLength,
		normalBytes,
	});
}

const tatami = await tatamiImages();
await addMaterial(
	"tatami",
	find(TATAMI),
	tatami.color,
	tatami.normal,
	TATAMI_TILE,
);
for (const { key, pattern } of SOURCES) {
	const original = find(pattern);
	const colorTexture = original.getBaseColorTexture();
	if (colorTexture === null) {
		console.error(`停止: ${original.getName()} に色の絵が無い`);
		process.exit(2);
	}
	const colorPng = await square(colorTexture.getImage()).png().toBuffer();
	const normalTexture = original.getNormalTexture();
	const normalPng =
		normalTexture === null
			? null
			: await square(normalTexture.getImage()).png().toBuffer();
	await addMaterial(key, original, colorPng, normalPng, tileOf(original));
}

scene.setExtras({ rondoStageMaterials: { version: 1, materials: info } });
out.getRoot().setDefaultScene(scene);
const glb = await new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.writeBinary(out);
mkdirSync(output, { recursive: true });
for (const quality of QUALITIES) {
	writeFileSync(join(output, `stage-materials-${quality}.glb`), glb);
}

console.log(
	`材質: ${join(outputArg, "stage-materials-{512,1024}.glb")}（${glb.byteLength} バイト。畳の目の1枚 ${tatami.weaveTile} m）`,
);
console.log(
	[
		"鍵",
		"1枚(m)",
		"平均色(線形)",
		"平均色(sRGB)",
		"色の絵(KB)",
		"法線の絵(KB)",
	].join("\t"),
);
for (const r of report) {
	console.log(
		[
			r.key,
			r.tile,
			r.mean.map((v) => v.toFixed(4)).join(","),
			hex(r.mean),
			(r.colorBytes / 1024).toFixed(1),
			(r.normalBytes / 1024).toFixed(1),
		].join("\t"),
	);
}
