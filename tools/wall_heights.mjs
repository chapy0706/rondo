/**
 * 平屋の壁・襖の板・欄間の高さを、glb から測る（issue-46 / ADR 0043 のカメラの高さの確認）。
 *
 * 使い方:
 *   node tools/wall_heights.mjs assets-src/house/hiraya-fbx.glb
 *   node tools/wall_heights.mjs assets-src/house/hiraya-fbx.glb --edges   # 壁の辺ごとの値も出す
 *
 * - 地図は平屋の共有の見本（packages/contracts/src/fixtures/veryare-hiraya-stage.json）から読む
 * - 床の高さは apps/web/src/games/veryare/hiraya.ts の FLOOR_HEIGHTS・FLOOR_EXCEPTIONS から読む
 *   （tools/floor_heights.mjs で測った表）
 * - 壁: 内壁・外壁・床の間の壁（和室Aと和室Bの仕切り）。地図の、戸ではない領域の境の辺ごとに、辺と直角に ±0.2 m を 0.02 m おきに真上から測り、
 *   内壁・外壁のノードの三角形に当たる高さのうち、いちばん高いものを、そこの壁の上端とする
 *   （格子の線は、壁の中心線から最大 0.125 m ずれるため、幅を持たせて測る）
 * - 襖の板: 襖の操作軸の下の「本体」の頂点の高さの最大
 * - 欄間の板: 欄間の操作軸の下の「本体」の頂点の高さの最小と最大。中心の位置で、下の襖と対応づける
 * - 天井: 歩けるマスの中心で、天井（天井 室内）のノードに当たる最も低い所（天井の下面）。天井の無い
 *   所（縁側）は、屋根（寄棟屋根）のノードに当たる最も低い所（軒の下面）も出す
 * - どれも、ワールドの y と、床からの高さ（そこの床の高さを引いたもの）で出す
 *
 * 入力は読むだけで、変更しない。
 */

import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const WALL = /^(内壁-|外壁-|床の間 壁-)/;
const FUSUMA_AXIS = /^(ドア 引違い戸( 4枚戸)?|腰付障子 引違い戸 4枚戸) 操作軸/;
const RANMA_AXIS = /^欄間 4枚戸 操作軸/;
/** 天井（屋根と天井の glb に入るもの）と、天井の無い所（縁側）の上にある屋根。 */
const CEILING = /^天井 室内/;
const ROOF = /^寄棟屋根 /;

const args = process.argv.slice(2);
const showEdges = args.includes("--edges");
const [input] = args.filter((a) => !a.startsWith("--"));
if (input === undefined) {
	console.error("使い方: node tools/wall_heights.mjs <平屋の glb> [--edges]");
	process.exit(2);
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const stage = JSON.parse(
	read("../packages/contracts/src/fixtures/veryare-hiraya-stage.json"),
).stage;

/** hiraya.ts の床の高さの表（FLOOR_HEIGHTS と FLOOR_EXCEPTIONS）を、ファイルから読む。 */
const hirayaTs = read("../apps/web/src/games/veryare/hiraya.ts");
const tableBlock = /FLOOR_HEIGHTS[^{]*\{([^}]*)\}/.exec(hirayaTs)?.[1] ?? "";
const floorOf = new Map(
	// キーは、記号なら引用符つき、文字なら引用符なし（Biome の整形）。
	[...tableBlock.matchAll(/(?:"(.)"|([A-Za-z]))\s*:\s*([0-9.]+)/g)].map((m) => [
		m[1] ?? m[2],
		Number(m[3]),
	]),
);
const exceptionBlock =
	/FLOOR_EXCEPTIONS[\s\S]*?\] = \[([\s\S]*?)\n\];/.exec(hirayaTs)?.[1] ?? "";
const floorException = new Map(
	[...exceptionBlock.matchAll(/\[(\d+), (\d+), "(.)", ([0-9.]+)\]/g)].map(
		(m) => [`${m[1]},${m[2]}`, Number(m[4])],
	),
);
if (floorOf.size === 0) {
	console.error("停止: hiraya.ts の FLOOR_HEIGHTS を読めない");
	process.exit(2);
}

const charAt = (x, z) => [...(stage.rows[z] ?? "")][x] ?? "~";
const regionAt = (x, z) => stage.regions[charAt(x, z)] ?? null;
const floorAt = (x, z) =>
	floorException.get(`${x},${z}`) ?? floorOf.get(charAt(x, z)) ?? 0;
const edgeKey = (a, b) =>
	a.x < b.x || (a.x === b.x && a.z <= b.z)
		? `${a.x},${a.z}|${b.x},${b.z}`
		: `${b.x},${b.z}|${a.x},${a.z}`;
const doors = new Map(stage.doors.map((d) => [edgeKey(d.a, d.b), d.kind]));

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

/** ノードと子孫の、ワールド座標の三角形と頂点。 */
function geometryOf(top) {
	const triangles = [];
	const points = [];
	top.traverse((node) => {
		const mesh = node.getMesh();
		if (mesh === null) return;
		const world = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute("POSITION");
			for (let i = 0; i < pos.getCount(); i++) {
				points.push(apply(world, pos.getElement(i, [])));
			}
			if (prim.getMode() !== 4) continue;
			const idx = prim.getIndices();
			const count = idx ? idx.getCount() : pos.getCount();
			const at = (i) =>
				apply(world, pos.getElement(idx ? idx.getScalar(i) : i, []));
			for (let i = 0; i + 2 < count; i += 3) {
				triangles.push([at(i), at(i + 1), at(i + 2)]);
			}
		}
	});
	return { triangles, points };
}

const nodes = [];
const collect = (node) => {
	nodes.push(node);
	for (const child of node.listChildren()) collect(child);
};
for (const top of scene.listChildren()) collect(top);

function hitY([a, b, c], x, z) {
	const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
	if (Math.abs(d) < 1e-12) return null;
	const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
	const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
	if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) return null;
	return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}

const round = (y) => Math.round(y * 1000) / 1000;

// --- 壁 ---------------------------------------------------------------------------
const wallTriangles = nodes
	.filter((n) => WALL.test(n.getName()))
	.flatMap((n) => geometryOf(n).triangles);

/** 点 (x, z) の真上から見た、壁の三角形の最も高い当たり。 */
function wallTop(x, z) {
	let top = null;
	for (const t of wallTriangles) {
		const y = hitY(t, x, z);
		if (y !== null && (top === null || y > top)) top = y;
	}
	return top;
}

const ox = stage.origin.x;
const oz = stage.origin.z;
const cs = stage.cellSize;
const wallEdges = [];
for (let z = 0; z < stage.depth; z++) {
	for (let x = 0; x < stage.width; x++) {
		const here = regionAt(x, z);
		if (here === null) continue;
		for (const [nx, nz] of [
			[x + 1, z],
			[x, z + 1],
			[x - 1, z],
			[x, z - 1],
		]) {
			const there = regionAt(nx, nz);
			if (there === here) continue;
			const key = edgeKey({ x, z }, { x: nx, z: nz });
			if (doors.has(key)) continue;
			// 内側の壁（両側が歩ける）は、片側からだけ数える。
			if (there !== null && (nx < x || nz < z)) continue;
			const vertical = nx !== x; // x が変わる境は、x が一定の線
			const line = vertical
				? ox + cs * Math.max(x, nx)
				: oz + cs * Math.max(z, nz);
			const mid = vertical ? oz + cs * (z + 0.5) : ox + cs * (x + 0.5);
			let top = null;
			for (let o = -0.2; o <= 0.2001; o += 0.02) {
				const px = vertical ? line + o : mid;
				const pz = vertical ? mid : line + o;
				const y = wallTop(px, pz);
				if (y !== null && (top === null || y > top)) top = y;
			}
			const floor = Math.max(
				floorAt(x, z),
				there === null ? 0 : floorAt(nx, nz),
			);
			wallEdges.push({
				x,
				z,
				nx,
				nz,
				pair: `${charAt(x, z)}|${there === null ? "外" : charAt(nx, nz)}`,
				px: vertical ? line : mid,
				pz: vertical ? mid : line,
				top: top === null ? null : round(top),
				floor,
			});
		}
	}
}

const measured = wallEdges.filter((e) => e.top !== null);
const missing = wallEdges.length - measured.length;
const byPair = new Map();
for (const e of measured) {
	const list = byPair.get(e.pair) ?? [];
	list.push(e);
	byPair.set(e.pair, list);
}
console.log(
	`壁の辺: ${wallEdges.length}（壁のノードに当たらない辺: ${missing}）`,
);
console.log(
	"WALL\t境（領域|領域）\t辺の数\t上端の最小\t上端の最大\t床からの最小\t最小の場所 (x, z)",
);
for (const [pair, list] of [...byPair].sort()) {
	const low = list.reduce((p, q) => (q.top < p.top ? q : p));
	const high = Math.max(...list.map((e) => e.top));
	const above = Math.min(...list.map((e) => round(e.top - e.floor)));
	console.log(
		`WALL\t${pair}\t${list.length}\t${low.top}\t${high}\t${above}\t(${round(low.px)}, ${round(low.pz)})`,
	);
}
const lowest = measured.reduce((p, q) =>
	q.top - q.floor < p.top - p.floor ? q : p,
);
console.log(
	`WALL_LOWEST\t${lowest.pair}\t上端 ${lowest.top}\t床 ${lowest.floor}\t床から ${round(lowest.top - lowest.floor)}\t(${round(lowest.px)}, ${round(lowest.pz)})`,
);
if (showEdges) {
	for (const e of wallEdges) {
		console.log(
			`EDGE\t${e.x},${e.z}|${e.nx},${e.nz}\t${e.pair}\t${e.top ?? "（当たらない）"}\t床 ${e.floor}`,
		);
	}
}

// --- 襖の板と欄間 ----------------------------------------------------------------------
const boxOf = (points) => ({
	minY: Math.min(...points.map((p) => p[1])),
	maxY: Math.max(...points.map((p) => p[1])),
	cx:
		(Math.min(...points.map((p) => p[0])) +
			Math.max(...points.map((p) => p[0]))) /
		2,
	cz:
		(Math.min(...points.map((p) => p[2])) +
			Math.max(...points.map((p) => p[2]))) /
		2,
	sx:
		Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
	sz:
		Math.max(...points.map((p) => p[2])) - Math.min(...points.map((p) => p[2])),
});

/** 戸の線の両側のマスの領域の文字（長辺が x なら、z の前後）。 */
const sidesOf = (box) => {
	const cell = (x, z) => [Math.floor((x - ox) / cs), Math.floor((z - oz) / cs)];
	const [a, b] =
		box.sx >= box.sz
			? [cell(box.cx, box.cz - 0.15), cell(box.cx, box.cz + 0.15)]
			: [cell(box.cx - 0.15, box.cz), cell(box.cx + 0.15, box.cz)];
	return [a, b]
		.filter(([x, z]) => regionAt(x, z) !== null)
		.map(([x, z]) => charAt(x, z));
};
const panelsOf = (axis) =>
	axis.listChildren().filter((c) => c.getName().includes("本体"));
const floorNear = (x, z) => {
	const cx = Math.floor((x - ox) / cs);
	const cz = Math.floor((z - oz) / cs);
	// 戸の線の両側のマスのうち、高いほうの床（低い床から見るほど、遮るものは高く見える）。
	let best = 0;
	for (const [dx, dz] of [
		[0, 0],
		[-1, 0],
		[0, -1],
		[-1, -1],
		[1, 0],
		[0, 1],
	]) {
		if (regionAt(cx + dx, cz + dz) !== null)
			best = Math.max(best, floorAt(cx + dx, cz + dz));
	}
	return best;
};

const fusuma = nodes
	.filter((n) => FUSUMA_AXIS.test(n.getName()))
	.map((axis) => {
		const all = boxOf(geometryOf(axis).points);
		const panel = boxOf(panelsOf(axis).flatMap((p) => geometryOf(p).points));
		return {
			name: axis.getName(),
			cx: all.cx,
			cz: all.cz,
			top: round(panel.maxY),
			bottom: round(panel.minY),
			sides: sidesOf(all),
		};
	});
console.log(
	"FUSUMA\t操作軸\t中心 (x, z)\t板の下端\t板の上端\t床（高いほう）\t床からの上端\t両側の領域",
);
for (const f of fusuma) {
	const floor = floorNear(f.cx, f.cz);
	console.log(
		`FUSUMA\t${f.name}\t(${round(f.cx)}, ${round(f.cz)})\t${f.bottom}\t${f.top}\t${floor}\t${round(f.top - floor)}\t${f.sides.join("|")}`,
	);
}

const ranma = nodes
	.filter((n) => RANMA_AXIS.test(n.getName()))
	.map((axis) => {
		const all = boxOf(geometryOf(axis).points);
		const panel = boxOf(panelsOf(axis).flatMap((p) => geometryOf(p).points));
		const below = fusuma.reduce((p, q) =>
			Math.hypot(q.cx - all.cx, q.cz - all.cz) <
			Math.hypot(p.cx - all.cx, p.cz - all.cz)
				? q
				: p,
		);
		const far = Math.hypot(below.cx - all.cx, below.cz - all.cz) > 0.3;
		return {
			name: axis.getName(),
			cx: all.cx,
			cz: all.cz,
			bottom: round(panel.minY),
			top: round(panel.maxY),
			below: far ? "（襖の上ではない）" : below.name,
			sides: sidesOf(all),
		};
	});
console.log(
	"RANMA\t操作軸\t中心 (x, z)\t下端\t上端\t床（高いほう）\t床からの下端\t床からの上端\t下の襖\t両側の領域",
);
for (const r of ranma) {
	const floor = floorNear(r.cx, r.cz);
	console.log(
		`RANMA\t${r.name}\t(${round(r.cx)}, ${round(r.cz)})\t${r.bottom}\t${r.top}\t${floor}\t${round(r.bottom - floor)}\t${round(r.top - floor)}\t${r.below}\t${r.sides.join("|")}`,
	);
}

// --- 領域ごとの集計（カメラの高さの判定の入力 / apps/web/src/games/veryare/cameraHeight.ts） ------
/**
 * REGION の行: 領域の文字、床の最大（例外のマスを含む）、接する壁の上端の最小、接する襖の板の上端の
 * 最小、接する欄間の下端の最小（無ければ -）。どれもワールドの y。
 */
const floors = new Map();
for (let z = 0; z < stage.depth; z++) {
	for (let x = 0; x < stage.width; x++) {
		if (regionAt(x, z) === null) continue;
		const c = charAt(x, z);
		floors.set(c, Math.max(floors.get(c) ?? 0, floorAt(x, z)));
	}
}
const minOf = (values) => (values.length === 0 ? "-" : Math.min(...values));

/** マスの中心で、真上から見た、三角形に当たる最も低い所（無ければ null）。 */
const lowestHit = (triangles, x, z) => {
	let low = null;
	for (const t of triangles) {
		const y = hitY(t, x, z);
		if (y !== null && (low === null || y < low)) low = y;
	}
	return low;
};
const ceilingTriangles = nodes
	.filter((n) => CEILING.test(n.getName()))
	.flatMap((n) => geometryOf(n).triangles);
const roofTriangles = nodes
	.filter((n) => ROOF.test(n.getName()) && n.getMesh() !== null)
	.flatMap((n) => geometryOf(n).triangles);
const ceilings = new Map();
const roofs = new Map();
for (let z = 0; z < stage.depth; z++) {
	for (let x = 0; x < stage.width; x++) {
		if (regionAt(x, z) === null) continue;
		const c = charAt(x, z);
		const cx = ox + cs * (x + 0.5);
		const cz = oz + cs * (z + 0.5);
		const ceiling = lowestHit(ceilingTriangles, cx, cz);
		if (ceiling !== null)
			ceilings.set(
				c,
				Math.min(ceilings.get(c) ?? Number.POSITIVE_INFINITY, ceiling),
			);
		const roof = lowestHit(roofTriangles, cx, cz);
		if (roof !== null)
			roofs.set(c, Math.min(roofs.get(c) ?? Number.POSITIVE_INFINITY, roof));
	}
}
console.log(
	"REGION\t領域\t床の最大\t壁の上端の最小\t襖の板の上端の最小\t欄間の下端の最小\t天井の下面の最小\t屋根の下面の最小",
);
for (const c of [...floors.keys()].sort()) {
	const walls = measured
		.filter((e) => e.pair.split("|").includes(c))
		.map((e) => e.top);
	const doors = fusuma.filter((f) => f.sides.includes(c)).map((f) => f.top);
	const transoms = ranma
		.filter((r) => r.sides.includes(c))
		.map((r) => r.bottom);
	console.log(
		`REGION\t${c}\t${floors.get(c)}\t${minOf(walls)}\t${minOf(doors)}\t${minOf(transoms)}\t${ceilings.has(c) ? round(ceilings.get(c)) : "-"}\t${roofs.has(c) ? round(roofs.get(c)) : "-"}`,
	);
}
