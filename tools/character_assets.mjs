/**
 * キャラクターの素材を作る（issue-56）。体の glb と、ポーズの表の glb を書き出す。
 *
 * 使い方:
 *   node tools/character_assets.mjs assets-src/converted/characters assets-src/delivery/v2/characters
 *
 * 入力のフォルダ: x-bot.glb（基準姿勢の体）と、ポーズの glb 23 本（共有の見本
 * packages/contracts/src/fixtures/veryare-poses.json の source の名前 + ".glb"）。
 * 出力（品質 512 と 1024 は同じ中身。体にテクスチャが無く、manifest は key と品質で引くため）:
 * - character-body-{512,1024}.glb: X Bot を meshopt で圧縮したもの（量子化 + EXT_meshopt_compression）
 * - character-poses-{512,1024}.glb: メッシュは持たず、scene の extras の rondoPoses に、ポーズの表
 *   { version: 1, standingHeight, bindMin, bindMax, joints, poses: { id: { t, r, s?, min, max } } } を
 *   入れたもの。クライアントは apps/web/src/games/veryare/bodyPose.ts の parsePoseTable で検証して使う
 * 出したら tools/make_manifest.mjs で manifest を作り直す。
 *
 * 表の作り方:
 * - 骨の姿勢（位置 t・回転 r・大きさ s）は、各ポーズの glb の骨（mixamorig:）のノードの値を、体の骨の
 *   名前の順にそろえて取る。骨の名前・数が体と違えば、止まる（終了コード 2）
 * - 大きさ s は、どの骨も 1 なら省く
 * - 外接箱（bindMin・bindMax・各ポーズの min・max）は、書き出した圧縮後の体を three で読み、その
 *   ポーズを骨に当てて、全頂点をスキンで動かして測る（クライアントが描くのと同じ体で測るため）。
 *   座標は、体の glb の scene の座標（メートル）
 * - standingHeight は、基準姿勢の外接箱の高さ
 *
 * 入力は読むだけで、変更しない。素材はリポジトリに入れないので、リポジトリの中では assets-src/ の
 * 下だけに書く。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const QUALITIES = [512, 1024];
const DECIMALS = 5;

const [inputArg, outputArg] = process.argv.slice(2);
if (inputArg === undefined || outputArg === undefined) {
	console.error(
		"使い方: node tools/character_assets.mjs <変換済みのキャラクターのフォルダ> <出力先のフォルダ>",
	);
	process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(inputArg);
const output = resolve(outputArg);
const inRepo = output === repo || output.startsWith(repo + sep);
if (inRepo && !output.startsWith(join(repo, "assets-src") + sep)) {
	console.error(
		`停止: リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）: ${output}`,
	);
	process.exit(2);
}

const fixture = JSON.parse(
	readFileSync(
		join(repo, "packages/contracts/src/fixtures/veryare-poses.json"),
		"utf8",
	),
);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.decoder": MeshoptDecoder,
		"meshopt.encoder": MeshoptEncoder,
	});

const round = (v) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

// --- 体 ----------------------------------------------------------------------------

const body = await io.read(join(input, "x-bot.glb"));
const skin = body.getRoot().listSkins()[0];
if (skin === undefined) {
	console.error("停止: x-bot.glb にスキンが無い");
	process.exit(2);
}
const joints = skin.listJoints().map((j) => j.getName());
await body.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
const bodyGlb = await io.writeBinary(body);
mkdirSync(output, { recursive: true });
for (const quality of QUALITIES) {
	writeFileSync(join(output, `character-body-${quality}.glb`), bodyGlb);
}

// --- ポーズの骨の姿勢 ---------------------------------------------------------------

const poses = {};
for (const { id, source } of fixture.poses) {
	const doc = await io.read(join(input, `${source}.glb`));
	const poseSkin = doc.getRoot().listSkins()[0];
	const names = poseSkin?.listJoints().map((j) => j.getName()) ?? [];
	if (names.join("|") !== joints.join("|")) {
		console.error(`停止: ${source}.glb の骨の名前・並びが、体と違う`);
		process.exit(2);
	}
	const nodes = poseSkin.listJoints();
	const t = nodes.map((n) => n.getTranslation().map(round));
	const r = nodes.map((n) => n.getRotation().map(round));
	const s = nodes.map((n) => n.getScale().map(round));
	const unitScale = s.every((v) => v.every((x) => Math.abs(x - 1) < 1e-6));
	poses[id] = unitScale ? { t, r } : { t, r, s };
}

// --- 外接箱（圧縮後の体を three で読み、スキンで動かして測る） ------------------------

const three = (path) =>
	import(pathToFileURL(join(repo, "apps/web/node_modules/three", path)).href);
const THREE = await three("build/three.module.js");
const { GLTFLoader } = await three("examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder: ThreeMeshoptDecoder } = await three(
	"examples/jsm/libs/meshopt_decoder.module.js",
);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(ThreeMeshoptDecoder);
const buffer = bodyGlb.buffer.slice(
	bodyGlb.byteOffset,
	bodyGlb.byteOffset + bodyGlb.byteLength,
);
const gltf = await loader.parseAsync(buffer, "");
const scene = gltf.scene;
const meshes = [];
scene.traverse((node) => {
	if (node.isSkinnedMesh) meshes.push(node);
});
const bones = new Map();
scene.traverse((node) => {
	if (node.isBone) bones.set(node.userData.name ?? node.name, node);
});
const restPose = joints.map((name) => {
	const bone = bones.get(name);
	if (bone === undefined) {
		console.error(`停止: 圧縮後の体に骨 ${name} が無い`);
		process.exit(2);
	}
	return {
		bone,
		t: bone.position.clone(),
		r: bone.quaternion.clone(),
		s: bone.scale.clone(),
	};
});

function bounds() {
	scene.updateMatrixWorld(true);
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
	const v = new THREE.Vector3();
	for (const mesh of meshes) {
		const count = mesh.geometry.getAttribute("position").count;
		for (let i = 0; i < count; i++) {
			mesh.getVertexPosition(i, v);
			v.applyMatrix4(mesh.matrixWorld);
			const p = [v.x, v.y, v.z];
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k], p[k]);
				hi[k] = Math.max(hi[k], p[k]);
			}
		}
	}
	return { min: lo.map(round), max: hi.map(round) };
}

const bind = bounds();
const standingHeight = round(bind.max[1] - bind.min[1]);
for (const [id, pose] of Object.entries(poses)) {
	restPose.forEach(({ bone }, i) => {
		bone.position.fromArray(pose.t[i]);
		bone.quaternion.fromArray(pose.r[i]);
		bone.scale.fromArray(pose.s?.[i] ?? [1, 1, 1]);
	});
	Object.assign(pose, bounds());
	poses[id] = pose;
}
for (const { bone, t, r, s } of restPose) {
	bone.position.copy(t);
	bone.quaternion.copy(r);
	bone.scale.copy(s);
}

// --- 表の glb -----------------------------------------------------------------------

const table = {
	version: 1,
	standingHeight,
	bindMin: bind.min,
	bindMax: bind.max,
	joints,
	poses,
};
const out = new Document();
out.createBuffer();
const posesScene = out.createScene("poses");
posesScene.setExtras({ rondoPoses: table });
out.getRoot().setDefaultScene(posesScene);
const posesGlb = await new NodeIO().writeBinary(out);
for (const quality of QUALITIES) {
	writeFileSync(join(output, `character-poses-${quality}.glb`), posesGlb);
}

// --- 報告 ---------------------------------------------------------------------------

const scale = 1.6 / standingHeight;
console.log(
	`体: ${join(outputArg, "character-body-{512,1024}.glb")}（${bodyGlb.byteLength} バイト。骨 ${joints.length} 本、メッシュ ${meshes.length} 個）`,
);
console.log(
	`ポーズの表: ${join(outputArg, "character-poses-{512,1024}.glb")}（${posesGlb.byteLength} バイト。${Object.keys(poses).length} 種類）`,
);
console.log(
	`基準姿勢の高さ ${standingHeight} m（体の高さ 1.6 m への倍率 ${scale.toFixed(4)}）`,
);
console.log(
	["識別子", "一番低い点(m)", "高さ(m)", "体の高さ 1.6 m での高さ(m)"].join(
		"\t",
	),
);
for (const [id, pose] of Object.entries(poses)) {
	console.log(
		[
			id,
			pose.min[1].toFixed(3),
			(pose.max[1] - pose.min[1]).toFixed(3),
			((pose.max[1] - pose.min[1]) * scale).toFixed(3),
		].join("\t"),
	);
}
