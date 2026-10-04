/**
 * 戸・障子・欄間の一覧を TSV に書き出す（Node だけで動く）。
 *
 * 使い方:
 *   node tools/list_doors.mjs assets-src/house/hiraya-preview-scene.json assets-src/house/doors.tsv
 *
 * 入力は tools/inspect_glb.mjs の調査結果（既定のシーンのノード）。名前に「ドア」「障子」「欄間」を
 * 含むノードすべてについて、名前、親、寸法（m。子孫を含む外接箱）、中心位置（x, z）、
 * 長辺の向き（x方向 / z方向）、床からの高さ（外接箱の下端の y）、襖の候補かを書き出す。
 *
 * 襖の候補: 「ドア 引違い戸」（2枚戸）と「ドア 引違い戸 4枚戸」、「腰付障子 引違い戸 4枚戸」の部品。
 * 片開き戸と、玄関の引違い戸（名前に「玄関」を含む）は候補にしない。
 * 標準出力には、引違い戸の組（操作軸のノードごと）の位置と向きを出す。
 *
 * 外接箱は、子孫に開口の箱（名前に「 B-」を含む部品。戸の開口の大きさの箱）があれば、
 * それを使う。素材には、ワールドの原点に置かれてしまう小さな部品（ドアノブなど）があり、
 * 子孫すべての外接箱だと原点まで伸びてしまうため。
 */

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
	console.error("使い方: node tools/list_doors.mjs <調査結果.json> <出力.tsv>");
	process.exit(2);
}

const FITTINGS = /ドア|障子|欄間/;

function isFusumaCandidate(name) {
	if (/玄関|片開き戸/.test(name)) return false;
	return /ドア 引違い戸|腰付障子 引違い戸 4枚戸/.test(name);
}

const survey = JSON.parse(readFileSync(input, "utf8"));
const nodes = survey.nodes.filter((node) => node.inDefaultScene);
const byIndex = new Map(nodes.map((node) => [node.index, node]));

const OPENING = /\sB-\d/;

/** 子孫の中の、開口の箱の部品（あれば）。 */
function openingOf(node) {
	const stack = [...node.children];
	while (stack.length > 0) {
		const current = byIndex.get(stack.pop());
		if (!current) continue;
		if (OPENING.test(current.name) && current.mesh?.worldBox) return current;
		stack.push(...current.children);
	}
	return null;
}

/** 外接箱。開口の箱があればそれを、無ければ子孫を含む外接箱。 */
function boundsOf(node) {
	const opening = openingOf(node);
	if (opening !== null) return subtreeBounds(opening);
	return subtreeBounds(node);
}

/** 子孫を含む、ワールドの外接箱。 */
function subtreeBounds(node) {
	const min = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	const stack = [node];
	let found = false;
	while (stack.length > 0) {
		const current = stack.pop();
		const box = current.mesh?.worldBox;
		if (box) {
			found = true;
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], box.min[i]);
				max[i] = Math.max(max[i], box.max[i]);
			}
		}
		for (const child of current.children) {
			const next = byIndex.get(child);
			if (next) stack.push(next);
		}
	}
	return found ? { min, max } : null;
}

const fixed = (value) => value.toFixed(3);

function describe(node) {
	const box = boundsOf(node);
	if (box === null) return null;
	const size = box.max.map((v, i) => v - box.min[i]);
	const center = box.max.map((v, i) => (v + box.min[i]) / 2);
	return {
		name: node.name,
		parent: node.parentName ?? "",
		size,
		centerX: center[0],
		centerZ: center[2],
		// 床の上に立つ戸の、横の長さ（x か z の長い方）。
		direction: size[0] >= size[2] ? "x方向" : "z方向",
		floor: box.min[1],
		fusuma: isFusumaCandidate(node.name),
	};
}

const rows = nodes
	.filter((node) => FITTINGS.test(node.name))
	.map(describe)
	.filter((row) => row !== null);

const header = [
	"名前",
	"親",
	"幅x(m)",
	"高さy(m)",
	"奥行きz(m)",
	"中心x",
	"中心z",
	"長辺の向き",
	"床からの高さ(m)",
	"襖の候補",
];
const lines = rows.map((row) =>
	[
		row.name,
		row.parent,
		...row.size.map(fixed),
		fixed(row.centerX),
		fixed(row.centerZ),
		row.direction,
		fixed(row.floor),
		row.fusuma ? "はい" : "いいえ",
	].join("\t"),
);
writeFileSync(output, `${[header.join("\t"), ...lines].join("\n")}\n`);
console.log(
	`書き出し: ${output}（${rows.length} 行、襖の候補 ${rows.filter((r) => r.fusuma).length}）`,
);

// 引違い戸の組（操作軸のノード）ごとの位置と向き。
const sets = rows.filter(
	(row) => /引違い戸/.test(row.name) && /操作軸/.test(row.name),
);
console.log(
	"組\t幅x\t高さy\t奥行きz\t中心x\t中心z\t長辺の向き\t床から\t襖の候補",
);
for (const row of sets) {
	console.log(
		[
			row.name,
			...row.size.map(fixed),
			fixed(row.centerX),
			fixed(row.centerZ),
			row.direction,
			fixed(row.floor),
			row.fusuma ? "はい" : "いいえ",
		].join("\t"),
	);
}
