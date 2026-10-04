/**
 * 平屋の間取りの断面図（上から見た図）を SVG に書き出す（Node と @gltf-transform）。
 *
 * 使い方:
 *   node tools/house_plan.mjs assets-src/house/hiraya-preview.glb assets-src/house/plan.svg
 *
 * - 高さ y = 1.0m の水平面で、外壁と内壁のメッシュを切り、断面の線分を描く（黒）
 * - 畳と部屋床は、上から見た輪郭（外接箱）を描く。畳には名前を付ける
 * - 戸・障子は、上から見た箱の輪郭を、種類ごとに色を変えて描く
 *   （襖の候補の引違い戸: 橙、腰付障子: 緑、片開き戸: 紫、玄関の戸: 灰、ガラス戸: 青）。
 *   箱は、開口の箱の部品（名前に「 B-」を含む子孫）があればそれを使う（原点に置かれてしまう
 *   小さな部品で箱が伸びないように）
 * - 1m ごとの格子と、x・z の目盛りを入れる。右が +x、下が +z（玄関側）
 * 入力は読むだけで、変更しない。
 */

import { writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
	console.error("使い方: node tools/house_plan.mjs <入力.glb> <出力.svg>");
	process.exit(2);
}

/** 切る高さ（m）。 */
const CUT_Y = 1.0;
/** 1m あたりの px。 */
const SCALE = 48;
/** 図のまわりの余白（m）。 */
const MARGIN = 1.5;

const WALLS = /^(外壁|内壁)/;
const TATAMI = /^畳/;
const FLOOR = /^部屋床/;
/** 戸・障子の組（トップレベル）。 */
const FITTING = /^(ドア|腰付障子|ガラス 引違い戸)/;
/** 開口の箱の部品。 */
const OPENING = /\sB-\d/;
/** 戸・障子の種類と、その色（上から順に当てる）。 */
const FITTING_KINDS = [
	["玄関の戸", /玄関/, "#888888"],
	["腰付障子", /^腰付障子/, "#1b9e77"],
	["襖の候補（引違い戸）", /^ドア 引違い戸/, "#e6750a"],
	["片開き戸", /^ドア 片開き戸/, "#7b3fbf"],
	["ガラス戸", /^ガラス 引違い戸/, "#3b82c4"],
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const root = document.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

// --- 壁を切る ---------------------------------------------------------------

function transform(m, x, y, z) {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

/** 三角形と水平面 y = CUT_Y の交わり（線分）。交わらなければ null。 */
function cut(a, b, c) {
	const points = [];
	for (const [p, q] of [
		[a, b],
		[b, c],
		[c, a],
	]) {
		const dp = p[1] - CUT_Y;
		const dq = q[1] - CUT_Y;
		if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
			const t = dp / (dp - dq);
			points.push([p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t]);
		}
	}
	return points.length === 2 ? points : null;
}

const segments = [];
const walls = [];
scene.traverse((node) => {
	if (!WALLS.test(node.getName())) return;
	const mesh = node.getMesh();
	if (mesh === null) return;
	walls.push(node.getName());
	const m = node.getWorldMatrix();
	for (const primitive of mesh.listPrimitives()) {
		if (primitive.getMode() !== 4) continue;
		const position = primitive.getAttribute("POSITION");
		const indices = primitive.getIndices();
		const count = indices ? indices.getCount() : position.getCount();
		const vertex = (i) => {
			const p = position.getElement(indices ? indices.getScalar(i) : i, []);
			return transform(m, p[0], p[1], p[2]);
		};
		for (let i = 0; i + 2 < count; i += 3) {
			const segment = cut(vertex(i), vertex(i + 1), vertex(i + 2));
			if (segment) segments.push(segment);
		}
	}
});

// --- 畳・部屋床・戸 --------------------------------------------------------------

function rectOf(node) {
	const { min, max } = getBounds(node);
	return { x0: min[0], z0: min[2], x1: max[0], z1: max[2] };
}

const tatami = [];
const floors = [];
scene.traverse((node) => {
	const name = node.getName();
	if (node.getMesh() === null) return;
	if (TATAMI.test(name)) tatami.push({ name, ...rectOf(node) });
	if (FLOOR.test(name)) floors.push({ name, ...rectOf(node) });
});

const fittings = [];
for (const top of scene.listChildren()) {
	const name = top.getName();
	if (!FITTING.test(name)) continue;
	const kind = FITTING_KINDS.find(([, pattern]) => pattern.test(name));
	if (!kind) continue;
	let opening = null;
	top.traverse((node) => {
		if (opening === null && OPENING.test(node.getName()) && node.getMesh()) {
			opening = node;
		}
	});
	fittings.push({
		name,
		kind: kind[0],
		color: kind[2],
		...rectOf(opening ?? top),
	});
}

// --- 範囲 ----------------------------------------------------------------

const xs = [];
const zs = [];
for (const [p, q] of segments) {
	xs.push(p[0], q[0]);
	zs.push(p[1], q[1]);
}
for (const r of [...tatami, ...floors, ...fittings]) {
	xs.push(r.x0, r.x1);
	zs.push(r.z0, r.z1);
}
const minX = Math.floor(Math.min(...xs) - MARGIN);
const maxX = Math.ceil(Math.max(...xs) + MARGIN);
const minZ = Math.floor(Math.min(...zs) - MARGIN);
const maxZ = Math.ceil(Math.max(...zs) + MARGIN);
const LEGEND = 300;
const width = (maxX - minX) * SCALE + LEGEND;
const height = (maxZ - minZ) * SCALE;
const sx = (x) => ((x - minX) * SCALE).toFixed(1);
const sz = (z) => ((z - minZ) * SCALE).toFixed(1);
const xml = (text) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- SVG ----------------------------------------------------------------

const parts = [];
parts.push(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`,
);
parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

// 格子と目盛り（1m ごと）。
for (let x = minX; x <= maxX; x++) {
	const strong = x === 0;
	parts.push(
		`<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${height}" stroke="${strong ? "#9aa" : "#dde"}" stroke-width="${strong ? 1.5 : 1}"/>`,
	);
	parts.push(
		`<text x="${sx(x)}" y="12" font-size="10" text-anchor="middle" fill="#557">x ${x}</text>`,
	);
}
for (let z = minZ; z <= maxZ; z++) {
	const strong = z === 0;
	parts.push(
		`<line x1="0" y1="${sz(z)}" x2="${(maxX - minX) * SCALE}" y2="${sz(z)}" stroke="${strong ? "#9aa" : "#dde"}" stroke-width="${strong ? 1.5 : 1}"/>`,
	);
	parts.push(
		`<text x="3" y="${Number(sz(z)) - 3}" font-size="10" fill="#557">z ${z}</text>`,
	);
}

// 部屋床と畳（上から見た輪郭）。
for (const r of floors) {
	parts.push(
		`<rect x="${sx(r.x0)}" y="${sz(r.z0)}" width="${((r.x1 - r.x0) * SCALE).toFixed(1)}" height="${((r.z1 - r.z0) * SCALE).toFixed(1)}" fill="#f4efe2" stroke="#c9b98f" stroke-width="1"><title>${xml(r.name)}</title></rect>`,
	);
}
for (const r of tatami) {
	const cx = (Number(sx(r.x0)) + Number(sx(r.x1))) / 2;
	const cz = (Number(sz(r.z0)) + Number(sz(r.z1))) / 2;
	const label = r.name.replace(/^畳-001 w90h180/, "畳").replace(/^畳\./, "畳 ");
	parts.push(
		`<rect x="${sx(r.x0)}" y="${sz(r.z0)}" width="${((r.x1 - r.x0) * SCALE).toFixed(1)}" height="${((r.z1 - r.z0) * SCALE).toFixed(1)}" fill="#dfe8c4" stroke="#8a9a55" stroke-width="1"><title>${xml(r.name)}</title></rect>`,
	);
	parts.push(
		`<text x="${cx.toFixed(1)}" y="${(cz + 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="#4d5a22">${xml(label)}</text>`,
	);
}

// 戸・障子（箱の輪郭）。
for (const r of fittings) {
	parts.push(
		`<rect x="${sx(r.x0)}" y="${sz(r.z0)}" width="${((r.x1 - r.x0) * SCALE).toFixed(1)}" height="${((r.z1 - r.z0) * SCALE).toFixed(1)}" fill="${r.color}" fill-opacity="0.15" stroke="${r.color}" stroke-width="2"><title>${xml(`${r.kind}: ${r.name}`)}</title></rect>`,
	);
}

// 壁の断面。
const path = segments
	.map(([p, q]) => `M${sx(p[0])} ${sz(p[1])}L${sx(q[0])} ${sz(q[1])}`)
	.join("");
parts.push(
	`<path d="${path}" stroke="#111111" stroke-width="2" fill="none" stroke-linecap="round"/>`,
);

// 凡例。
const lx = (maxX - minX) * SCALE + 16;
const legend = [
	["壁の断面（y = 1.0m）", "#111111"],
	["部屋床", "#c9b98f"],
	["畳", "#8a9a55"],
	...FITTING_KINDS.map(([label, , color]) => [label, color]),
];
parts.push(
	`<text x="${lx}" y="24" font-size="13" font-weight="bold" fill="#222">平屋 間取り（上から）</text>`,
);
parts.push(
	`<text x="${lx}" y="42" font-size="11" fill="#444">右が +x、下が +z（玄関側）。1マス 1m</text>`,
);
legend.forEach(([label, color], i) => {
	const y = 66 + i * 20;
	parts.push(
		`<rect x="${lx}" y="${y - 10}" width="14" height="12" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="2"/>`,
	);
	parts.push(
		`<text x="${lx + 20}" y="${y}" font-size="11" fill="#222">${xml(label)}</text>`,
	);
});

parts.push("</svg>");
writeFileSync(output, `${parts.join("\n")}\n`);
console.log(
	`書き出し: ${output}（壁 ${walls.join("・")} の断面 ${segments.length} 本、畳 ${tatami.length}、部屋床 ${floors.length}、戸・障子 ${fittings.length}。範囲 x ${minX}〜${maxX}、z ${minZ}〜${maxZ}）`,
);
