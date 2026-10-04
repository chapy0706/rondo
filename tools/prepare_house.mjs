/**
 * 平屋の確認用 glb を作る（Node と @gltf-transform）。
 *
 * 使い方:
 *   node tools/prepare_house.mjs \
 *     assets-src/house/hiraya.glb \
 *     assets-src/house/hiraya-scene.json \
 *     assets-src/house/hiraya-preview.glb
 *
 * 1. 既定のシーン以外（白背景の LineArt 用シーン）を、そのノードごと取り除く
 * 2. 屋根と天井のノードを取り除く。名前は tools/inspect_glb.mjs の調査結果（scene.json）の、
 *    既定のシーンのノードから、屋根・天井の名前のものを選ぶ（ゲームの TPS カメラを遮るため）
 * 3. 使われなくなったメッシュ・マテリアル・テクスチャを整理する（prune。空のノードは残す）
 * 4. 重複を統合する（dedup）
 * テクスチャの中身（大きさ・形式）は変えない。マテリアルの拡張（ガラスの透過など）は残す。
 * 入力は読むだけで、変更しない。
 */

import { readFileSync, statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";

const [input, sceneJson, output] = process.argv.slice(2);
if (input === undefined || sceneJson === undefined || output === undefined) {
	console.error(
		"使い方: node tools/prepare_house.mjs <入力.glb> <調査結果.json> <出力.glb>",
	);
	process.exit(2);
}

/** 取り除く部位（inspect_glb.mjs の屋根・天井と同じ見分け方）。 */
const REMOVED_PARTS = [
	["屋根", /屋根|yane|roof/i],
	["天井", /天井|tenjo|tenjou|ceil/i],
];

const survey = JSON.parse(readFileSync(sceneJson, "utf8"));
const removedNames = new Set(
	survey.nodes
		.filter((node) => node.inDefaultScene)
		.filter((node) =>
			REMOVED_PARTS.some(([, pattern]) => pattern.test(node.name)),
		)
		.map((node) => node.name),
);

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const document = await io.read(input);
const root = document.getRoot();
const scenes = root.listScenes();
const defaultScene = root.getDefaultScene() ?? scenes[0];

/** ノードと、その子孫すべて。 */
function subtree(node) {
	const all = [];
	node.traverse((child) => {
		all.push(child);
	});
	return all;
}

// 1. 既定のシーン以外を、ノードごと取り除く。
for (const scene of scenes) {
	if (scene === defaultScene) continue;
	console.log(`シーンを取り除く: ${scene.getName()}`);
	for (const top of scene.listChildren()) {
		for (const node of subtree(top).reverse()) node.dispose();
	}
	scene.dispose();
}

// 2. 屋根と天井を取り除く。名前が一覧にないのに、親ごと消える子孫があれば知らせる。
const targets = [];
defaultScene.traverse((node) => {
	if (removedNames.has(node.getName())) targets.push(node);
});
const removed = [];
const collateral = [];
for (const node of targets) {
	if (node.isDisposed()) continue;
	for (const child of subtree(node).reverse()) {
		if (child.isDisposed()) continue;
		if (removedNames.has(child.getName())) removed.push(child.getName());
		else collateral.push(child.getName());
		child.dispose();
	}
}
console.log(`屋根・天井として取り除いたノード: ${removed.length}`);
for (const name of removed) console.log(`  - ${name}`);
if (collateral.length > 0) {
	console.log(
		`親と一緒に取り除いた、名前が一覧にないノード: ${collateral.length}`,
	);
	for (const name of collateral) console.log(`  - ${name}`);
}

// 3・4. 使われなくなったものを整理し、重複を統合する（テクスチャの中身は変えない）。
// prune の既定は、中身の無い末端のノード（空のノード）も消すが、ここでは消さない
// （ドアの回転軸などの空のノードが、後で要るかもしれないため）。
await document.transform(prune({ keepLeaves: true }), dedup());

await io.write(output, document);

const mb = (path) => (statSync(path).size / 1024 / 1024).toFixed(1);
console.log(`書き出し: ${output}（${mb(output)} MB。入力 ${mb(input)} MB）`);
console.log(
	`残り: ノード ${root.listNodes().length}、メッシュ ${root.listMeshes().length}、マテリアル ${root.listMaterials().length}、テクスチャ ${root.listTextures().length}`,
);
