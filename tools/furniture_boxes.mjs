/**
 * 平屋の家具の箱（AABB）を、glb から取り出す（カメラの守り / issue-46 の続き）。
 *
 * 使い方:
 *   node tools/furniture_boxes.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house
 *   node tools/furniture_boxes.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house --list
 *
 * 出力は、出力先のフォルダの hiraya-furniture-512.glb と hiraya-furniture-1024.glb（中身は同じ。
 * manifest は key と品質で引くため、両方の品質に置く）。メッシュは持たず、scene の extras の
 * rondoFurniture に { version: 1, boxes: [{ name, min: [x,y,z], max: [x,y,z] }] } を入れる。
 * クライアントは、three の GLTFLoader が scene の userData に写したものを検証して使う
 * （apps/web/src/games/veryare/furniture.ts）。出したら tools/make_manifest.mjs で manifest を作り直す。
 *
 * 箱の取り方:
 * - 元の glb（圧縮の前。ノードの階層と名前が残っている）の、メッシュを持つノードごとに、ワールドの
 *   座標の箱を作る（圧縮後の glb は、別々の物のメッシュがまとめられているため使わない）
 * - 建物の部分（壁・床・畳・天井・屋根・長押・戸・襖・欄間・窓・雨戸・ガラス・押し入れの枠）と屋外の
 *   飾り（下見板張・塀・木）、壁の小物（コンセント・スイッチ・電源コード）は、根の名前で除く。
 *   根が家具でも、葉のノードが壁やガラス（床の間の L 字の壁など）なら除く。
 *   壁と戸は、地図の守り（領域の境）で守る
 * - 小物（最も長い辺が SMALL 未満）と、透ける物（色の不透明度が 1 未満、または名前に「ガラス」）は除く
 * - カメラの高さの範囲に入りえない物は除く: 上端が「いちばん低い床 + 目の高さ − 家具の余白」より低い
 *   物（目からカメラへの線は、目より下を通らない）と、下端が「いちばん高い床 + カメラの最高点 + 家具の
 *   余白」より高い物
 *
 * 入力は読むだけで、変更しない。素材はリポジトリに入れないので、リポジトリの中では assets-src/ の
 * 下だけに書く。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

/** 根の名前で除くもの（建物の部分・屋外の飾り・壁の小物）。 */
const EXCLUDE =
	/^(内壁|外壁|床の間 壁|部屋床|畳|縁側|玄関床|玄関階段|地面|天井|寄棟屋根|長押|和室 押し入れ|ドア|欄間|腰付障子|窓|雨戸|ガラス|下見板張|塀|木|低木|コンセント|コ埋|照明スイッチ|電源コード)/;
/**
 * 葉のノードの名前で除くもの（根が家具でも、中に壁やガラスがあるもの。例: 床の間の根の下の
 * 「床の間 壁」は L 字の壁で、箱にすると床の間全体を覆ってしまう）。
 */
const EXCLUDE_NODE = /^(床の間 壁|内壁|外壁|ガラス)/;
/** 小物の大きさ（最も長い辺。メートル）。 */
const SMALL = 0.15;
/** 目の高さ（apps/web/src/games/veryare/camera.ts の EYE_HEIGHT）。 */
const EYE_HEIGHT = 0.8;
/** 足もとからのカメラの最高点（cameraHeight.test.ts の cameraTopAboveFeet。約 1.692 m）。 */
const CAMERA_TOP = 1.692;
/** 家具の余白（cameraGuard.ts の CAMERA_FURNITURE_MARGIN）。 */
const MARGIN = 0.1;
const QUALITIES = [512, 1024];

const args = process.argv.slice(2);
const showList = args.includes("--list");
const [input, outDir] = args.filter((a) => !a.startsWith("--"));
if (input === undefined || outDir === undefined) {
	console.error(
		"使い方: node tools/furniture_boxes.mjs <平屋の元の glb> <出力先のフォルダ> [--list]",
	);
	process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(outDir);
const inRepo = out === repo || out.startsWith(repo + sep);
if (inRepo && !out.startsWith(join(repo, "assets-src") + sep)) {
	console.error(
		`停止: リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）: ${out}`,
	);
	process.exit(2);
}

/** 床の高さの表（hiraya.ts の FLOOR_HEIGHTS と FLOOR_EXCEPTIONS）の、いちばん低い値と高い値。 */
const hirayaTs = readFileSync(
	join(repo, "apps/web/src/games/veryare/hiraya.ts"),
	"utf8",
);
const tableBlock = /FLOOR_HEIGHTS[^{]*\{([^}]*)\}/.exec(hirayaTs)?.[1] ?? "";
const exceptionBlock =
	/FLOOR_EXCEPTIONS[\s\S]*?\] = \[([\s\S]*?)\n\];/.exec(hirayaTs)?.[1] ?? "";
const floors = [
	...[...tableBlock.matchAll(/:\s*([0-9.]+)/g)].map((m) => Number(m[1])),
	...[...exceptionBlock.matchAll(/\[\d+, \d+, ".", ([0-9.]+)\]/g)].map((m) =>
		Number(m[1]),
	),
];
if (floors.length === 0) {
	console.error("停止: hiraya.ts の FLOOR_HEIGHTS を読めない");
	process.exit(2);
}
const lowest = Math.min(...floors) + EYE_HEIGHT - MARGIN;
const highest = Math.max(...floors) + CAMERA_TOP + MARGIN;

await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(input);
const scene =
	document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];

function apply(m, p) {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

/** 透ける材質か（色の不透明度が 1 未満、または名前に「ガラス」）。 */
const seeThrough = (material) =>
	material !== null &&
	(material.getBaseColorFactor()[3] < 0.99 ||
		material.getName().includes("ガラス"));

const floor3 = (v) => Math.floor(v * 1000) / 1000;
const ceil3 = (v) => Math.ceil(v * 1000) / 1000;

const boxes = [];
const skipped = { excluded: 0, small: 0, clear: 0, out: 0 };
for (const root of scene.listChildren()) {
	const rootName = root.getName();
	root.traverse((node) => {
		const mesh = node.getMesh();
		if (mesh === null) return;
		if (EXCLUDE.test(rootName) || EXCLUDE_NODE.test(node.getName())) {
			skipped.excluded += 1;
			return;
		}
		const world = node.getWorldMatrix();
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
		let opaque = false;
		for (const prim of mesh.listPrimitives()) {
			if (seeThrough(prim.getMaterial())) continue;
			opaque = true;
			const pos = prim.getAttribute("POSITION");
			for (let i = 0; i < pos.getCount(); i++) {
				const p = apply(world, pos.getElement(i, []));
				for (let k = 0; k < 3; k++) {
					lo[k] = Math.min(lo[k], p[k]);
					hi[k] = Math.max(hi[k], p[k]);
				}
			}
		}
		if (!opaque) {
			skipped.clear += 1;
			return;
		}
		const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
		if (longest < SMALL) {
			skipped.small += 1;
			return;
		}
		if (hi[1] < lowest || lo[1] > highest) {
			skipped.out += 1;
			return;
		}
		const name =
			node === root
				? rootName
				: `${rootName} / ${node.getName() || "(名前なし)"}`;
		boxes.push({
			name,
			min: lo.map(floor3),
			max: hi.map(ceil3),
		});
	});
}
boxes.sort((a, b) => a.name.localeCompare(b.name, "ja"));

const output = new Document();
output.createBuffer();
const furnitureScene = output.createScene("furniture");
furnitureScene.setExtras({ rondoFurniture: { version: 1, boxes } });
output.getRoot().setDefaultScene(furnitureScene);
const glb = await new NodeIO().writeBinary(output);
mkdirSync(out, { recursive: true });
for (const quality of QUALITIES) {
	writeFileSync(join(out, `hiraya-furniture-${quality}.glb`), glb);
}

console.log(
	`家具の箱: ${boxes.length} 個（除いたもの: 建物・屋外・壁の小物 ${skipped.excluded}、小物 ${skipped.small}、透ける物 ${skipped.clear}、高さの範囲の外 ${skipped.out}）`,
);
console.log(
	`高さの範囲: 上端 ${lowest.toFixed(3)} m 以上、下端 ${highest.toFixed(3)} m 以下`,
);
console.log(
	`書いた: ${QUALITIES.map((q) => join(outDir, `hiraya-furniture-${q}.glb`)).join("、")}（${glb.byteLength} バイト）`,
);
if (showList) {
	for (const box of boxes) {
		console.log([box.name, box.min.join(","), box.max.join(",")].join("\t"));
	}
}
