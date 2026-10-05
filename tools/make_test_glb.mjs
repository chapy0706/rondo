/**
 * 素材の配信の疎通を確かめるための、小さな glb（立方体）と manifest.json を作る（issue-43）。
 *
 * 使い方:
 *   node tools/make_test_glb.mjs assets-src/test
 *
 * 出力（コミットしない。assets-src/ は .gitignore で除外している）:
 *   <出力>/manifest.json
 *   <出力>/v1/test/test-cube-512.glb   （1辺 1m の立方体。色は黄）
 *   <出力>/v1/test/test-cube-1024.glb  （同じ形。色は青。品質の切り替えを目で見分けるため）
 *
 * 出力フォルダの中身を、そのまま A1 の素材ディレクトリに置けば、manifest の key "test-cube" で
 * 読み込める。素材の版を上げるときは、パスの v1 を v2 にし、manifest の version も上げる。
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";

const [outputDir] = process.argv.slice(2);
if (outputDir === undefined) {
	console.error("使い方: node tools/make_test_glb.mjs <出力フォルダ>");
	process.exit(2);
}

const VERSION = 1;
const KEY = "test-cube";
const VARIANTS = [
	{ quality: 512, color: [0.98, 0.8, 0.08, 1] },
	{ quality: 1024, color: [0.2, 0.55, 0.95, 1] },
];

/** 1辺 1m の立方体（面ごとに頂点を分け、法線を持たせる）。 */
function cube(document, color) {
	const faces = [
		[
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		],
		[
			[-1, 0, 0],
			[0, 1, 0],
			[0, 0, -1],
		],
		[
			[0, 1, 0],
			[0, 0, 1],
			[1, 0, 0],
		],
		[
			[0, -1, 0],
			[0, 0, -1],
			[1, 0, 0],
		],
		[
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0],
		],
		[
			[0, 0, -1],
			[-1, 0, 0],
			[0, 1, 0],
		],
	];
	const positions = [];
	const normals = [];
	const indices = [];
	for (const [n, u, v] of faces) {
		const base = positions.length / 3;
		for (const [su, sv] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		]) {
			for (let i = 0; i < 3; i++) {
				positions.push(0.5 * (n[i] + su * u[i] + sv * v[i]));
			}
			normals.push(...n);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	const buffer = document.getRoot().listBuffers()[0];
	const position = document
		.createAccessor()
		.setType("VEC3")
		.setArray(new Float32Array(positions))
		.setBuffer(buffer);
	const normal = document
		.createAccessor()
		.setType("VEC3")
		.setArray(new Float32Array(normals))
		.setBuffer(buffer);
	const index = document
		.createAccessor()
		.setType("SCALAR")
		.setArray(new Uint16Array(indices))
		.setBuffer(buffer);
	const material = document
		.createMaterial("test-cube")
		.setBaseColorFactor(color)
		.setRoughnessFactor(0.6);
	const primitive = document
		.createPrimitive()
		.setAttribute("POSITION", position)
		.setAttribute("NORMAL", normal)
		.setIndices(index)
		.setMaterial(material);
	return document.createMesh("test-cube").addPrimitive(primitive);
}

const io = new NodeIO();
const assets = [];
for (const { quality, color } of VARIANTS) {
	const document = new Document();
	document.createBuffer();
	const mesh = cube(document, color);
	const node = document.createNode("test-cube").setMesh(mesh);
	document.createScene("test").addChild(node);
	const path = `v${VERSION}/test/${KEY}-${quality}.glb`;
	const file = join(outputDir, path);
	mkdirSync(dirname(file), { recursive: true });
	await io.write(file, document);
	assets.push({
		key: KEY,
		quality,
		version: VERSION,
		path,
		bytes: statSync(file).size,
	});
	console.log(`書き出し: ${file}（${statSync(file).size} バイト）`);
}

const manifest = { version: 1, assets };
const manifestFile = join(outputDir, "manifest.json");
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`書き出し: ${manifestFile}`);
