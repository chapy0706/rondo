/**
 * glb の大きさと中身の数を表にする（Node と @gltf-transform）。
 *
 * 使い方:
 *   node tools/glb_stats.mjs [--box 名前の正規表現] [--count 名前の正規表現] a.glb b.glb ...
 *
 * 各ファイルについて、ファイルサイズ、ノード数、メッシュ数、三角形数、マテリアル数、テクスチャ数を、
 * タブ区切りで出す。三角形数は、既定のシーンで描く数（インスタンスの数を掛ける）。
 * --box を付けると、名前が当たるノード（子孫を含む）のワールドの外接箱も出す。
 * --count を付けると、名前が当たるノードの数（うちメッシュを持つ数）も出す。
 * 入力は読むだけで、変更しない。
 */

import { statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

const args = process.argv.slice(2);
let boxPattern = null;
let countPattern = null;
const files = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--box") {
		boxPattern = new RegExp(args[i + 1]);
		i++;
	} else if (args[i] === "--count") {
		countPattern = new RegExp(args[i + 1]);
		i++;
	} else {
		files.push(args[i]);
	}
}
if (files.length === 0) {
	console.error(
		"使い方: node tools/glb_stats.mjs [--box 名前の正規表現] a.glb ...",
	);
	process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function triangles(mesh) {
	let sum = 0;
	for (const primitive of mesh.listPrimitives()) {
		if (primitive.getMode() !== 4) continue;
		const indices = primitive.getIndices();
		sum += (indices ?? primitive.getAttribute("POSITION")).getCount() / 3;
	}
	return sum;
}

const round = (v) => Math.round(v * 1000) / 1000;

console.log(
	"ファイル\tサイズ(MB)\tノード\tメッシュ\t三角形\tマテリアル\tテクスチャ",
);
for (const file of files) {
	const document = await io.read(file);
	const root = document.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
	let drawn = 0;
	const meshes = new Set();
	scene.traverse((node) => {
		const mesh = node.getMesh();
		if (mesh === null) return;
		meshes.add(mesh);
		const batch = node.getExtension("EXT_mesh_gpu_instancing");
		const copies = batch ? (batch.listAttributes()[0]?.getCount() ?? 1) : 1;
		drawn += triangles(mesh) * copies;
	});
	console.log(
		[
			file,
			(statSync(file).size / 1024 / 1024).toFixed(2),
			root.listNodes().length,
			meshes.size,
			Math.round(drawn),
			root.listMaterials().length,
			root.listTextures().length,
		].join("\t"),
	);
	if (countPattern !== null) {
		const matched = root
			.listNodes()
			.filter((node) => countPattern.test(node.getName()));
		console.log(
			`  COUNT\t${countPattern.source}\t${matched.length}（メッシュあり ${matched.filter((n) => n.getMesh()).length}）`,
		);
	}
	if (boxPattern !== null) {
		scene.traverse((node) => {
			if (!boxPattern.test(node.getName())) return;
			const { min, max } = getBounds(node);
			console.log(
				`  BOX\t${node.getName()}\tmin ${min.map(round).join(", ")}\tmax ${max.map(round).join(", ")}\tsize ${max.map((v, i) => round(v - min[i])).join(", ")}`,
			);
		});
	}
}
