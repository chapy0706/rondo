/**
 * 平屋の床の高さを、glb から測る（issue-46 の体の足もと）。
 *
 * 使い方:
 *   node tools/floor_heights.mjs assets-src/house/hiraya-fbx.glb
 *   node tools/floor_heights.mjs assets-src/house/hiraya-fbx.glb --cells   # マスごとの値も出す
 *
 * - 地図（歩けるマスと領域の文字）は、平屋の共有の見本
 *   packages/contracts/src/fixtures/veryare-hiraya-stage.json から読む（サーバーの hiraya.gleam と同じ）
 * - 床のノード（名前で選ぶ。FLOOR。どの階層にあってもよい）の三角形だけを使い、家具は使わない
 * - 歩けるマスの中心から真下へ線を下ろし、床のノードの三角形に当たる高さ（ワールドの y）を測る。
 *   1つのマスに複数のノードが当たるときは、ノードごとの値を出し、いちばん高いものをそのマスの床とする
 * - 領域（文字）ごとに、マスの数・床の高さの最小・最大・最頻値と、当たったノードの名前を出す。
 *   どの床のノードにも当たらないマスがあれば、数を出す
 *
 * 入力は読むだけで、変更しない。
 */

import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

/** 床のノード（名前の先頭。どの階層のノードでもよい）。家具・建具は含めない。 */
const FLOOR =
	/^(畳-|部屋床-|玄関床-|お風呂 床-|縁側-\d|床の間 床板-001$|床の間 前板-)/;

const args = process.argv.slice(2);
const showCells = args.includes("--cells");
const [input] = args.filter((a) => !a.startsWith("--"));
if (input === undefined) {
	console.error("使い方: node tools/floor_heights.mjs <平屋の glb> [--cells]");
	process.exit(2);
}

const fixture = JSON.parse(
	readFileSync(
		new URL(
			"../packages/contracts/src/fixtures/veryare-hiraya-stage.json",
			import.meta.url,
		),
		"utf8",
	),
);
const stage = fixture.stage;

await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(input);
const root = document.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

function apply(m, p) {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

/**
 * 床のノード（と子孫）の、ワールド座標の三角形。床のノードは、どの階層にあってもよい（床の間の床板と
 * 前板は「床の間 操作軸」の子）。床のノードの子孫は、そのノードの一部として扱う。
 */
const floorNodes = [];
const findFloors = (node) => {
	if (FLOOR.test(node.getName())) {
		floorNodes.push(node);
		return;
	}
	for (const child of node.listChildren()) findFloors(child);
};
for (const top of scene.listChildren()) findFloors(top);

const floors = [];
for (const top of floorNodes) {
	const triangles = [];
	top.traverse((node) => {
		const mesh = node.getMesh();
		if (mesh === null) return;
		const world = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== 4) continue;
			const pos = prim.getAttribute("POSITION");
			const idx = prim.getIndices();
			const count = idx ? idx.getCount() : pos.getCount();
			const at = (i) =>
				apply(world, pos.getElement(idx ? idx.getScalar(i) : i, []));
			for (let i = 0; i + 2 < count; i += 3) {
				triangles.push([at(i), at(i + 1), at(i + 2)]);
			}
		}
	});
	floors.push({ name: top.getName(), triangles });
}

/** 真下への線（x, z）が三角形に当たるときの y。当たらなければ null。 */
function hitY([a, b, c], x, z) {
	const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
	if (Math.abs(d) < 1e-12) return null; // 縦の面
	const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
	const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
	if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) return null;
	return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}

const round = (y) => Math.round(y * 1000) / 1000;
const byRegion = new Map();
const cellLines = [];
/** マスごとの床の高さ（いちばん高いノード）。当たらないマスは入れない。 */
const measured = [];
for (let z = 0; z < stage.depth; z++) {
	const row = [...stage.rows[z]];
	for (let x = 0; x < stage.width; x++) {
		const char = row[x];
		if (stage.regions[char] === undefined) continue;
		const cx = stage.origin.x + stage.cellSize * (x + 0.5);
		const cz = stage.origin.z + stage.cellSize * (z + 0.5);
		const hits = [];
		for (const floor of floors) {
			let top = null;
			for (const t of floor.triangles) {
				const y = hitY(t, cx, cz);
				if (y !== null && (top === null || y > top)) top = y;
			}
			if (top !== null) hits.push({ name: floor.name, y: round(top) });
		}
		hits.sort((p, q) => q.y - p.y);
		const region = byRegion.get(char) ?? {
			cells: 0,
			missing: 0,
			heights: new Map(),
			nodes: new Map(),
		};
		region.cells++;
		if (hits.length === 0) {
			region.missing++;
		} else {
			const [best] = hits;
			region.heights.set(best.y, (region.heights.get(best.y) ?? 0) + 1);
			measured.push({ x, z, char, y: best.y, name: best.name });
			const key = `${best.name}@${best.y}`;
			region.nodes.set(key, (region.nodes.get(key) ?? 0) + 1);
		}
		byRegion.set(char, region);
		if (showCells) {
			cellLines.push(
				`CELL\t${x}\t${z}\t${char}\t${hits.map((h) => `${h.name}=${h.y}`).join(" ") || "（当たらない）"}`,
			);
		}
	}
}

console.log(
	"領域\tマス\t当たらない\t最小\t最大\t最頻（マス数）\t当たったノード（いちばん高いもの@高さ: マス数）",
);
for (const [char, r] of [...byRegion].sort()) {
	const values = [...r.heights.keys()];
	const mode = [...r.heights].sort((p, q) => q[1] - p[1])[0];
	console.log(
		[
			"REGION",
			char,
			r.cells,
			r.missing,
			values.length ? Math.min(...values) : "-",
			values.length ? Math.max(...values) : "-",
			mode ? `${mode[0]}（${mode[1]}）` : "-",
			[...r.nodes].map(([k, n]) => `${k}: ${n}`).join(", "),
		].join("\t"),
	);
}
for (const line of cellLines) console.log(line);

/**
 * コードに書き込む表（apps/web/src/games/veryare/hiraya.ts の FLOOR_HEIGHTS と FLOOR_EXCEPTIONS）。
 * 領域の基準は最頻値。基準から SAME（5 mm）より離れたマスを、例外として出す。当たらないマスは、
 * 基準の値を使う（壁の線の上のマスで、中心が床の面の外に出ている）。
 */
const SAME = 0.005;
const modes = new Map();
for (const [char, r] of byRegion) {
	const mode = [...r.heights].sort((p, q) => q[1] - p[1])[0];
	if (mode) modes.set(char, mode[0]);
}
for (const [char, y] of [...modes].sort()) console.log(`TABLE\t${char}\t${y}`);
for (const m of measured) {
	const base = modes.get(m.char);
	if (base !== undefined && Math.abs(m.y - base) > SAME) {
		console.log(`EXCEPTION\t${m.x}\t${m.z}\t${m.char}\t${m.y}\t${m.name}`);
	}
}
