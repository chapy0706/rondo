/**
 * キャラクターの動きの素材を作る（issue-57）。待機・歩く・走るの動きだけを、小さな glb にする。
 *
 * 使い方（2段階）:
 *   # 1. Blender で、FBX を動きつきの glb にする（元の FBX は配らない）
 *   for f in Idle Walking "Medium Run"; do
 *     /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/fbx_to_glb.py -- \
 *       --input "assets-src/characters/$f.fbx" --output "assets-src/converted/motions/$f.glb" --animations
 *   done
 *   # 2. 動きだけを取り出す（--idle-fps で待機の動きを間引く。既定は間引かない）
 *   node tools/character_motions.mjs assets-src/converted/motions assets-src/delivery/v2/characters [--idle-fps 15]
 *
 * 出力: character-motions-{512,1024}.glb（中身は同じ。manifest は key と品質で引くため）。体のメッシュは
 * 持たず、骨の名前のノードと、動き idle・walk・run だけを持つ。scene の extras の rondoMotions に
 * { version: 1, clips: { idle|walk|run: { duration, stride, speed } } }（素材の scene の座標。メートル・
 * 秒）を入れる。クライアントは apps/web/src/games/veryare/motions.ts で検証して使う。出したら
 * tools/make_manifest.mjs で manifest を作り直す。
 *
 * 取り出し方:
 * - 動きの最初の時刻を 0 にそろえる
 * - 根（Hips）の、前へ進む分だけを直線で引く（apps/web/src/games/veryare/motionAsset.ts の detrendRoot）。
 *   上下の軸は、親（Armature）の行列で場面の上を向くノードの軸（upAxisOf）。小さな揺れと上下は残す
 * - 歩幅（strideOf）と 1 周期の秒数から、標準の速さを計算する
 * - 値の変わらない動き（大きさのすべてと、Hips 以外の骨の位置）を外す
 * - 冗長なコマを省く（resample）。回転は Float32 のまま（16 ビットの正規化した整数にすると、three で
 *   読んだときに、最初と最後の姿勢の差が約 1° に増えたため。大きさは目標に収まる）
 * - 骨の名前が体（x-bot.glb）に無いもの・最初と最後の姿勢の差を、標準出力に出す
 *
 * 入力は読むだけで、変更しない。リポジトリの中では assets-src/ の下だけに書く。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { resample } from "@gltf-transform/functions";

const SOURCES = [
	{ id: "idle", file: "Idle.glb" },
	{ id: "walk", file: "Walking.glb" },
	{ id: "run", file: "Medium Run.glb" },
];
const QUALITIES = [512, 1024];

const args = process.argv.slice(2);
const fpsAt = args.indexOf("--idle-fps");
const idleFps = fpsAt >= 0 ? Number(args[fpsAt + 1]) : null;
const [inputArg, outputArg] = args.filter(
	(a, i) => !a.startsWith("--") && (fpsAt < 0 || i !== fpsAt + 1),
);
if (inputArg === undefined || outputArg === undefined) {
	console.error(
		"使い方: node tools/character_motions.mjs <動きつきの glb のフォルダ> <出力先のフォルダ> [--idle-fps 15]",
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

// アプリの純粋な関数（motionAsset.ts）を、型を取り除いてそのまま読む。
const hook = `
export async function resolve(specifier, context, next) {
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.[a-z]+$/.test(specifier)) {
		try { return await next(specifier + ".ts", context); } catch {}
	}
	return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);
const {
	detrendRoot,
	horizontalRange,
	missingBones,
	seamAngle,
	strideOf,
	upAxisOf,
} = await import(
	pathToFileURL(join(repo, "apps/web/src/games/veryare/motionAsset.ts")).href
);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const body = await io.read(
	join(repo, "assets-src/converted/characters/x-bot.glb"),
);
const bodyBones = body
	.getRoot()
	.listSkins()[0]
	.listJoints()
	.map((j) => j.getName());

/** 列（要素ごと）の配列にする。 */
const rows = (accessor) =>
	Array.from({ length: accessor.getCount() }, (_, i) =>
		accessor.getElement(i, []),
	);

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene("motions");
const targets = new Map();
const nodeFor = (name) => {
	let node = targets.get(name);
	if (node === undefined) {
		node = out.createNode(name);
		scene.addChild(node);
		targets.set(name, node);
	}
	return node;
};

const clips = {};
const report = [];
for (const { id, file } of SOURCES) {
	const doc = await io.read(join(resolve(inputArg), file));
	const [animation] = doc.getRoot().listAnimations();
	if (animation === undefined) {
		console.error(`停止: ${file} に動きが無い（--animations で書き出したか）`);
		process.exit(2);
	}
	const channels = animation.listChannels();
	const names = [...new Set(channels.map((c) => c.getTargetNode().getName()))];
	const missing = missingBones(names, bodyBones);
	if (missing.length > 0) {
		console.error(`停止: ${file} の骨が体に無い: ${missing.join(", ")}`);
		process.exit(2);
	}
	const clip = out.createAnimation(id);
	let duration = 0;
	let stride = 0;
	let range = 0;
	const firstRotations = [];
	const lastRotations = [];
	for (const channel of channels) {
		const node = channel.getTargetNode();
		const name = node.getName();
		const path = channel.getTargetPath();
		const isHips = name === "mixamorig:Hips";
		if (path === "scale" || (path === "translation" && !isHips)) continue;
		const sampler = channel.getSampler();
		let times = Array.from(sampler.getInput().getArray());
		let values = rows(sampler.getOutput());
		const t0 = times[0] ?? 0;
		times = times.map((t) => t - t0);
		if (id === "idle" && idleFps !== null && idleFps > 0) {
			// 待機の動きを間引く（最後のコマは残す）。
			const step = Math.max(1, Math.round(30 / idleFps));
			const keep = times
				.map((_, i) => i)
				.filter((i) => i % step === 0 || i === times.length - 1);
			times = keep.map((i) => times[i]);
			values = keep.map((i) => values[i]);
		}
		duration = Math.max(duration, times[times.length - 1] ?? 0);
		if (isHips && path === "translation") {
			const parent = node.getParentNode()?.getWorldMatrix() ?? [
				1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
			];
			const up = upAxisOf(parent);
			const horizontal = [0, 1, 2].filter((axis) => axis !== up);
			const scale = Math.hypot(parent[0], parent[1], parent[2]);
			stride = strideOf(values, horizontal) * scale;
			values = detrendRoot(times, values, horizontal);
			range = horizontalRange(values, horizontal) * scale;
		}
		if (path === "rotation") {
			firstRotations.push(values[0]);
			lastRotations.push(values[values.length - 1]);
		}
		const input = out
			.createAccessor()
			.setType("SCALAR")
			.setArray(new Float32Array(times))
			.setBuffer(buffer);
		const flat = values.flat();
		const outputAccessor = out
			.createAccessor()
			.setType(path === "rotation" ? "VEC4" : "VEC3")
			.setBuffer(buffer);
		outputAccessor.setArray(new Float32Array(flat));
		const outSampler = out
			.createAnimationSampler()
			.setInput(input)
			.setOutput(outputAccessor)
			.setInterpolation(sampler.getInterpolation());
		clip
			.addSampler(outSampler)
			.addChannel(
				out
					.createAnimationChannel()
					.setTargetNode(nodeFor(name))
					.setTargetPath(path)
					.setSampler(outSampler),
			);
	}
	const speed = id === "idle" || duration <= 0 ? 0 : stride / duration;
	clips[id] = {
		duration: Math.round(duration * 1e5) / 1e5,
		stride: id === "idle" ? 0 : Math.round(stride * 1e5) / 1e5,
		speed: Math.round(speed * 1e5) / 1e5,
	};
	report.push({
		id,
		channels: clip.listChannels().length,
		duration,
		stride: id === "idle" ? 0 : stride,
		speed,
		range,
		seam: seamAngle(firstRotations, lastRotations),
	});
}

scene.setExtras({ rondoMotions: { version: 1, clips } });
out.getRoot().setDefaultScene(scene);
await out.transform(resample({ tolerance: 1e-4 }));
const glb = await io.writeBinary(out);
mkdirSync(output, { recursive: true });
for (const quality of QUALITIES) {
	writeFileSync(join(output, `character-motions-${quality}.glb`), glb);
}

const bodyScale = 1.6 / 1.80917;
console.log(
	`動き: ${join(outputArg, "character-motions-{512,1024}.glb")}（${glb.byteLength} バイト${idleFps === null ? "" : `。待機は ${idleFps} fps に間引いた`}）`,
);
console.log(
	[
		"動き",
		"動きの数",
		"1周期(秒)",
		"歩幅(m)",
		"標準の速さ(m/秒)",
		"体1.6mでの速さ(m/秒)",
		"根の水平の範囲(m)",
		"継ぎ目の差(度)",
	].join("\t"),
);
for (const r of report) {
	console.log(
		[
			r.id,
			r.channels,
			r.duration.toFixed(3),
			r.stride.toFixed(3),
			r.speed.toFixed(3),
			(r.speed * bodyScale).toFixed(3),
			r.range.toFixed(3),
			r.seam.toFixed(3),
		].join("\t"),
	);
}
