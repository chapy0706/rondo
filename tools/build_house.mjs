/**
 * 平屋のゲーム用 glb を作る（Node と @gltf-transform、テクスチャの変換に sharp）。
 *
 * 使い方:
 *   node tools/build_house.mjs assets-src/house/hiraya-fbx.glb assets-src/converted/house-fbx
 *
 * 出力（3つのグループ × テクスチャの長辺の上限 2種類 = 6本）:
 *   hiraya-indoor-{512,1024}.glb   屋内本体（建物、家具・設備、戸・障子・欄間、縁側、地面、玄関階段）
 *   hiraya-outdoor-{512,1024}.glb  屋外の飾り（木、低木、塀1・塀2、門まわり、縁側の踏み石）
 *   hiraya-roof-{512,1024}.glb     屋根と天井（ゲームの側で表示を切り替える）
 *
 * 手順:
 * 1. 既定のシーン以外（白背景の LineArt 用シーン）を、そのノードごと取り除く
 * 2. 取り除くもの: LineArt、浴室の外にあるシャワーの部品（お風呂 シャワー Curve。中心が浴室の床
 *    「お風呂 床」の範囲の外にあるときだけ）、中身の無い末端のノード（メッシュも子も無いもの。
 *    取り除いて末端になったものも続けて取り除く）。切り抜き用の箱（名前に「 B-」を含むもの）が
 *    残っていないかも数える
 * 3. トップレベルのノードの名前で、3つのグループに分ける
 * 4. 同じ形のメッシュ（低木_A など）を、インスタンス（EXT_mesh_gpu_instancing）にまとめる。
 *    ただし、戸・障子・欄間（名前に「ドア」「障子」「欄間」を含むノードとその子孫）は、
 *    1枚ずつ別のノードのまま残す（インスタンスにも統合にも入れない）
 * 5. 動かさない部品は、材質ごとに統合する（join。戸・障子・欄間とインスタンスは除く）
 * 6. 整理（prune）と、重複の統合（dedup）
 * 7. テクスチャを WebP にし、長辺を 512px / 1024px 以内に縮める（小さいものは拡大しない）
 *
 * マテリアルの不透明・半透明（テクスチャを変換する前に、グループに分ける前の全マテリアルで決める）:
 * - 襖・障子・欄間・和紙のマテリアル（名前で見分ける）は、必ず OPAQUE にする（向こう側の隠れ側が
 *   透けて見えないように）
 * - それ以外は、ベースカラーの alpha が 1 で、ベースカラーのテクスチャのうち、そのマテリアルの部品が
 *   UV で参照する画素に透明なものが無い（または、テクスチャが無い）ものを OPAQUE にする。参照する
 *   画素は、各頂点の UV と各三角形の中心の UV で調べ、透明（alpha 255 未満）が 0.01% 未満なら
 *   透明な画素が無いとみなす。カラーパレットのように、使っていない区画だけが透明な画像のため
 * - alpha が 1 未満のもの（ガラス、水など）と、テクスチャに透明な画素があるもの（葉、網戸など）は、
 *   元のまま（BLEND）残す
 *
 * 取り除いたノードの名前と数、グループごとのトップレベルのノード、各ファイルの大きさ・メッシュ数・
 * 三角形数・テクスチャ数を出す。
 * 入力は読むだけで、変更しない。
 */

import { mkdirSync, statSync } from "node:fs";
import { join as joinPath } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
	dedup,
	getBounds,
	instance,
	join,
	prune,
	textureCompress,
} from "@gltf-transform/functions";
import sharp from "sharp";

const [input, outputDir] = process.argv.slice(2);
if (input === undefined || outputDir === undefined) {
	console.error("使い方: node tools/build_house.mjs <入力.glb> <出力フォルダ>");
	process.exit(2);
}

/** テクスチャの長辺の上限（px）。 */
const SIZES = [512, 1024];

/** 取り除くトップレベルのノード（名前で指定するもの）。 */
const REMOVED = /^LineArt/;
/** 浴室の外にあるときだけ取り除く部品と、浴室の床。 */
const SHOWER = /^お風呂 シャワー Curve/;
const BATH_FLOOR = /^お風呂 床/;
/** 切り抜き用の箱。 */
const CUTTER = /\sB-/;

/** トップレベルのノードの名前で分けるグループ。どれにも当たらなければ屋内本体。 */
const GROUPS = [
	["roof", /^(寄棟屋根|天井)/],
	[
		"outdoor",
		/^(木-|低木|塀|表札|郵便受け|インターホン 子機|照明 門灯|縁側 踏み石)/,
	],
];
const GROUP_NAMES = ["indoor", "outdoor", "roof"];

/** 必ず OPAQUE にするマテリアル（襖・障子・欄間・和紙）。マテリアルの名前で見分ける。 */
const PAPER = /襖|障子|欄間|和紙|husuma|washi|shoji|ranma/i;

/** 戸・障子・欄間（1枚ずつ別のノードのまま残すもの）。 */
const FITTINGS = /ドア|障子|欄間/;

function groupOf(name) {
	for (const [group, pattern] of GROUPS) if (pattern.test(name)) return group;
	return "indoor";
}

const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ sharp: sharp });

/** ノードと、その子孫すべて（子孫が先）。 */
function subtree(node) {
	const all = [];
	node.traverse((child) => {
		all.push(child);
	});
	return all.reverse();
}

function isEmptyLeaf(node) {
	return (
		node.getMesh() === null &&
		node.getCamera() === null &&
		node.listChildren().length === 0 &&
		node.listExtensions().length === 0
	);
}

/** 自分か祖先の名前が、戸・障子・欄間か。 */
function isFitting(node) {
	let current = node;
	while (current) {
		if (FITTINGS.test(current.getName())) return true;
		current = current.getParentNode();
	}
	return false;
}

/** 参照する画素のうち、透明なものの割合がこれ未満なら、透明な画素が無いとみなす。 */
const TRANSPARENT_RATIO = 0.0001;

/**
 * ベースカラーのテクスチャのうち、そのマテリアルの部品が UV で参照する画素に、透明なものが
 * 無いか。各頂点の UV と、各三角形の中心の UV で、テクスチャの画素の alpha を調べる。
 * 戻り値は、透明な画素が無いか（ok）と、調べた数・透明だった数。
 */
async function opaqueWhereUsed(material) {
	const info = material.getBaseColorTextureInfo();
	const texture = material.getBaseColorTexture();
	const image = texture?.getImage() ?? null;
	if (texture === null || image === null)
		return { ok: true, sampled: 0, transparent: 0 };
	const { isOpaque } = await sharp(image).stats();
	if (isOpaque) return { ok: true, sampled: 0, transparent: 0 };

	const { data, info: size } = await sharp(image)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const alphaAt = (u, v) => {
		const x = Math.min(
			size.width - 1,
			Math.floor((u - Math.floor(u)) * size.width),
		);
		const y = Math.min(
			size.height - 1,
			Math.floor((v - Math.floor(v)) * size.height),
		);
		return data[(y * size.width + x) * 4 + 3];
	};
	const set = info?.getTexCoord() ?? 0;
	let sampled = 0;
	let transparent = 0;
	const check = (u, v) => {
		sampled++;
		if (alphaAt(u, v) < 255) transparent++;
	};
	for (const parent of material.listParents()) {
		if (parent.propertyType !== "Primitive") continue;
		const uv = parent.getAttribute(`TEXCOORD_${set}`);
		if (uv === null) continue;
		const at = (i) => uv.getElement(i, []);
		for (let i = 0; i < uv.getCount(); i++) check(...at(i));
		const indices = parent.getIndices();
		if (indices === null || parent.getMode() !== 4) continue;
		for (let i = 0; i + 2 < indices.getCount(); i += 3) {
			const a = at(indices.getScalar(i));
			const b = at(indices.getScalar(i + 1));
			const c = at(indices.getScalar(i + 2));
			check((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
		}
	}
	return {
		ok: sampled === 0 || transparent / sampled < TRANSPARENT_RATIO,
		sampled,
		transparent,
	};
}

/**
 * マテリアルの不透明・半透明を決めて直す。決めた結果（報告用）を返す。
 */
async function fixAlphaModes(document) {
	const results = [];
	for (const material of document.getRoot().listMaterials()) {
		const name = material.getName();
		const before = material.getAlphaMode();
		const alpha = material.getBaseColorFactor()[3];
		const texture = material.getBaseColorTexture();
		let after = before;
		let reason;
		if (PAPER.test(name)) {
			after = "OPAQUE";
			reason = "襖・障子・欄間・和紙";
		} else if (before === "OPAQUE") {
			reason = "もとから OPAQUE";
		} else if (alpha < 1) {
			reason = `alpha ${alpha.toFixed(2)}`;
		} else if (texture === null) {
			after = "OPAQUE";
			reason = "alpha 1、テクスチャ無し";
		} else {
			const used = await opaqueWhereUsed(material);
			const detail =
				used.sampled > 0
					? `（参照 ${used.sampled} のうち透明 ${used.transparent}）`
					: "";
			if (used.ok) {
				after = "OPAQUE";
				reason = `alpha 1、参照する画素に透明無し${detail}`;
			} else {
				reason = `参照する画素に透明あり${detail}`;
			}
		}
		material.setAlphaMode(after);
		results.push({ name, before, after, reason });
	}
	return results;
}

/**
 * 読み込んで、既定のシーンだけにし、取り除くものを取り除く。
 * 取り除いたノードの名前を返す（報告用）。
 */
async function load() {
	const document = await io.read(input);
	const root = document.getRoot();
	const scenes = root.listScenes();
	const scene = root.getDefaultScene() ?? scenes[0];
	for (const other of scenes) {
		if (other === scene) continue;
		for (const top of other.listChildren()) {
			for (const node of subtree(top)) node.dispose();
		}
		other.dispose();
	}

	const removed = { named: [], emptyLeaves: [], kept: [], cutters: 0 };
	scene.traverse((node) => {
		if (CUTTER.test(node.getName())) removed.cutters++;
	});
	let bath = null;
	scene.traverse((node) => {
		if (bath === null && BATH_FLOOR.test(node.getName()) && node.getMesh()) {
			bath = getBounds(node);
		}
	});
	const insideBath = (node) => {
		if (bath === null) return false;
		const { min, max } = getBounds(node);
		const x = (min[0] + max[0]) / 2;
		const z = (min[2] + max[2]) / 2;
		return (
			x >= bath.min[0] &&
			x <= bath.max[0] &&
			z >= bath.min[2] &&
			z <= bath.max[2]
		);
	};
	for (const top of scene.listChildren()) {
		const name = top.getName();
		const named = REMOVED.test(name);
		const strayShower = SHOWER.test(name) && !insideBath(top);
		if (SHOWER.test(name) && !strayShower) removed.kept.push(name);
		if (!named && !strayShower) continue;
		for (const node of subtree(top)) {
			removed.named.push(node.getName());
			node.dispose();
		}
	}
	// 中身の無い末端を、無くなるまで繰り返し取り除く（親が新たに末端になることがある）。
	for (;;) {
		const leaves = [];
		scene.traverse((node) => {
			if (isEmptyLeaf(node)) leaves.push(node);
		});
		if (leaves.length === 0) break;
		for (const node of leaves) {
			removed.emptyLeaves.push(node.getName());
			node.dispose();
		}
	}
	removed.alpha = await fixAlphaModes(document);

	const groups = { indoor: [], outdoor: [], roof: [] };
	for (const top of scene.listChildren()) {
		groups[groupOf(top.getName())].push(top.getName());
	}
	return { document, scene, removed, groups };
}

/** グループのものだけを残し、インスタンス・統合・整理・テクスチャの変換をする。 */
async function build(group, size) {
	const { document, scene, removed, groups } = await load();
	for (const top of scene.listChildren()) {
		if (groupOf(top.getName()) === group) continue;
		for (const node of subtree(top)) node.dispose();
	}

	await document.transform(prune(), dedup());

	// 戸・障子・欄間は、メッシュを共有していても1枚ずつ別のノードのまま残すため、
	// インスタンスにまとめる前に、それぞれ自分だけのメッシュを持たせる。
	const fittings = new Set();
	scene.traverse((node) => {
		if (!isFitting(node)) return;
		fittings.add(node);
		const mesh = node.getMesh();
		if (mesh !== null && mesh.listParents().length > 2) {
			node.setMesh(mesh.clone());
		}
	});

	await document.transform(
		instance({ min: 2 }),
		join({
			filter: (node) =>
				!fittings.has(node) &&
				node.getExtension("EXT_mesh_gpu_instancing") === null,
		}),
		prune(),
		dedup(),
		textureCompress({
			encoder: sharp,
			targetFormat: "webp",
			resize: [size, size],
		}),
		prune(),
	);

	const path = joinPath(outputDir, `hiraya-${group}-${size}.glb`);
	await io.write(path, document);
	return { path, removed, groups, stats: stats(document, path) };
}

/** 大きさ・メッシュ数・三角形数・テクスチャ数。三角形数は、インスタンスの数も掛けて数える。 */
export function stats(document, path) {
	const root = document.getRoot();
	let triangles = 0;
	let uniqueTriangles = 0;
	const countMesh = (mesh) => {
		let sum = 0;
		for (const primitive of mesh.listPrimitives()) {
			const indices = primitive.getIndices();
			const position = primitive.getAttribute("POSITION");
			const vertices = indices
				? indices.getCount()
				: (position?.getCount() ?? 0);
			if (primitive.getMode() === 4) sum += vertices / 3;
		}
		return sum;
	};
	for (const mesh of root.listMeshes()) uniqueTriangles += countMesh(mesh);
	for (const node of root.listNodes()) {
		const mesh = node.getMesh();
		if (mesh === null) continue;
		const batch = node.getExtension("EXT_mesh_gpu_instancing");
		const copies = batch ? (batch.listAttributes()[0]?.getCount() ?? 1) : 1;
		triangles += countMesh(mesh) * copies;
	}
	const instanced = root
		.listNodes()
		.filter((node) => node.getExtension("EXT_mesh_gpu_instancing")).length;
	return {
		megabytes: statSync(path).size / 1024 / 1024,
		meshes: root.listMeshes().length,
		triangles: Math.round(triangles),
		uniqueTriangles: Math.round(uniqueTriangles),
		textures: root.listTextures().length,
		nodes: root.listNodes().length,
		instancedBatches: instanced,
	};
}

mkdirSync(outputDir, { recursive: true });
let reported = false;
for (const group of GROUP_NAMES) {
	for (const size of SIZES) {
		const { path, removed, groups, stats: s } = await build(group, size);
		if (!reported) {
			reported = true;
			console.log("マテリアル\t変更前\t変更後\t理由");
			for (const row of removed.alpha) {
				console.log(
					`ALPHA\t${row.name}\t${row.before}\t${row.after}\t${row.reason}`,
				);
			}
			console.log(`切り抜き用の箱（名前に「 B-」）: ${removed.cutters}`);
			for (const name of removed.kept) {
				console.log(`浴室の中にあるので残した: ${name}`);
			}
			for (const [name, list] of Object.entries(groups)) {
				console.log(`グループ ${name}: ${list.length}`);
				for (const top of list) console.log(`  = ${top}`);
			}
			console.log(`取り除いた（名前で指定）: ${removed.named.length}`);
			for (const name of removed.named) console.log(`  - ${name}`);
			console.log(
				`取り除いた（中身の無い末端）: ${removed.emptyLeaves.length}`,
			);
			for (const name of removed.emptyLeaves) console.log(`  - ${name}`);
		}
		console.log(
			`STATS\t${path}\t${s.megabytes.toFixed(2)}MB\tメッシュ ${s.meshes}\t三角形 ${s.triangles}（形として ${s.uniqueTriangles}）\tテクスチャ ${s.textures}\tノード ${s.nodes}\tインスタンス ${s.instancedBatches}`,
		);
	}
}
