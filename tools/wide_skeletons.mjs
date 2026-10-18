#!/usr/bin/env node
/**
 * 広い屋敷の骨格を作る道具（issue-65 / ADR 0048）。Node の標準だけを使う。種を渡すと、同じ地図になる。
 *
 *   node tools/wide_skeletons.mjs                 # 30 種そろうまで種を 1 から進め、書き出す
 *   node tools/wide_skeletons.mjs --show 7        # 種 7 の地図を表示するだけ（書き出さない）
 *   node tools/wide_skeletons.mjs --check         # 書き出さず、そろった 30 種の数だけを表で出す
 *
 * 作り方（段階 1 の提案、issue-65 の決定）:
 * - 節点（2 x 2 m の曲がり角）を、横 6 m・縦 8 m おきに 5 x 8 個並べ、節点の間を 2 m 幅の廊下でつなぐ。
 *   廊下に囲まれた区画は、ちょうど 4 x 6 m（大スロット 1 つ）になる
 * - 迷路: 成長木（枝分かれの多い深さ優先）で、すべての節点をつなぎ、近道の輪を 2〜4 本足す。廊下を足すたびに、
 *   まっすぐな廊下が 14 m（部屋 2 つ分 12 m + 曲がり角の幅 2 m）を超えないかを見る
 * - 大スロット: 廊下に面した区画から 22〜26 を選び、面した廊下の 1 マスを襖（+）にする
 * - 小スロット: つながなかった縦の廊下の跡（2 x 6 m）の両端に、節点へ面した小スロット（2 x 1 m）を置き、
 *   節点のマスを襖にする。20〜26 を選ぶ
 * - 縁側（2 m）と庭（1 m）は、片側の長辺。玄関（5 x 4 m）は、手前の中央の節点の下（10 種と同じ置き方）
 *
 * 道具の中でも検算（server の skeleton_check.gleam と同じ条件）し、通った地図だけを書き出す。最終の判定は、
 * サーバーのテスト（skeleton_check_test.gleam）。
 *
 * 書き出す先:
 * - server/src/rondo_server/games/veryare/wide_skeleton_maps.gleam（使った種をコメントに残す）
 * - packages/contracts/src/fixtures/veryare-skeleton-stages.json の wideStages（はじめの 3 種。全スロットに
 *   部屋を割り当てたステージの通知。既存の stages は変えない）
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_GLEAM = join(
	root,
	"server/src/rondo_server/games/veryare/wide_skeleton_maps.gleam",
);
const OUT_FIXTURE = join(
	root,
	"packages/contracts/src/fixtures/veryare-skeleton-stages.json",
);

// --- 定数（skeleton_check.gleam と同じ） ------------------------------------------------

const NX = 5;
const NZ = 8;
const PX = 6;
const PZ = 8;
const STRAIGHT_MAX = 14;
const LARGE = [22, 26];
const SMALL = [20, 26];
const TOTAL = [46, 52];
const DEAD_ENDS = [5, 12];
const BRANCHES = [4, 10];
const FARTHEST_DOOR_MAX = 150;
const WIDE_MIN_WIDTH = 20;
const COUNT = 30;
const FIXTURE_COUNT = 3;

const MAZE_W = (NX - 1) * PX + 2; // 26
const MAZE_D = (NZ - 1) * PZ + 2; // 58
const ENTRANCE_ROWS = 4;
const WIDTH = MAZE_W + 3; // 縁側 2 + 庭 1
const DEPTH = MAZE_D + ENTRANCE_ROWS;

// --- 種つきの乱数（mulberry32） -----------------------------------------------------------

function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(items, next) {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// --- 格子 ------------------------------------------------------------------------

const key = (i, j) => `${i},${j}`;
const edgeKey = (a, b) =>
	a[1] < b[1] || (a[1] === b[1] && a[0] < b[0])
		? `${key(...a)}-${key(...b)}`
		: `${key(...b)}-${key(...a)}`;

/** 節点・廊下のマス（迷路の座標。x0 = 0, z0 = 0）。 */
function nodeCells(i, j) {
	const out = [];
	for (let dz = 0; dz < 2; dz++)
		for (let dx = 0; dx < 2; dx++) out.push([i * PX + dx, j * PZ + dz]);
	return out;
}
function edgeCells(a, b) {
	const out = [];
	if (a[1] === b[1]) {
		const i = Math.min(a[0], b[0]);
		const j = a[1];
		for (let dz = 0; dz < 2; dz++)
			for (let x = i * PX + 2; x < (i + 1) * PX; x++)
				out.push([x, j * PZ + dz]);
	} else {
		const i = a[0];
		const j = Math.min(a[1], b[1]);
		for (let z = j * PZ + 2; z < (j + 1) * PZ; z++)
			for (let dx = 0; dx < 2; dx++) out.push([i * PX + dx, z]);
	}
	return out;
}

const allEdges = (() => {
	const out = [];
	for (let j = 0; j < NZ; j++)
		for (let i = 0; i < NX; i++) {
			if (i + 1 < NX)
				out.push([
					[i, j],
					[i + 1, j],
				]);
			if (j + 1 < NZ)
				out.push([
					[i, j],
					[i, j + 1],
				]);
		}
	return out;
})();

/** 迷路の廊下の格子（true = 廊下）。 */
function corridorGrid(edges) {
	const g = Array.from({ length: MAZE_D }, () => Array(MAZE_W).fill(false));
	for (let j = 0; j < NZ; j++)
		for (let i = 0; i < NX; i++)
			for (const [x, z] of nodeCells(i, j)) g[z][x] = true;
	for (const e of edges.values())
		for (const [x, z] of edgeCells(...e)) g[z][x] = true;
	return g;
}

function straightOf(isCorridor, width, depth) {
	let best = 0;
	for (let z = 0; z < depth; z++) {
		let run = 0;
		for (let x = 0; x < width; x++) {
			run = isCorridor(x, z) ? run + 1 : 0;
			best = Math.max(best, run);
		}
	}
	for (let x = 0; x < width; x++) {
		let run = 0;
		for (let z = 0; z < depth; z++) {
			run = isCorridor(x, z) ? run + 1 : 0;
			best = Math.max(best, run);
		}
	}
	return best;
}

function straightOk(edges) {
	const g = corridorGrid(edges);
	return straightOf((x, z) => g[z][x], MAZE_W, MAZE_D) <= STRAIGHT_MAX;
}

// --- 1 枚を作る ------------------------------------------------------------------------

/** 種から、文字地図（行の配列）を作る。作れなければ null（理由つき）。 */
export function build(seed) {
	const next = random(seed);
	const edges = new Map();
	const add = (a, b) => edges.set(edgeKey(a, b), [a, b]);
	const tryAdd = (a, b) => {
		const k = edgeKey(a, b);
		edges.set(k, [a, b]);
		if (straightOk(edges)) return true;
		edges.delete(k);
		return false;
	};
	// 成長木。手前の中央（玄関の上）から始める。
	const start = [NX >> 1, NZ - 1];
	const seen = new Set([key(...start)]);
	const frontier = [start];
	while (frontier.length > 0) {
		const index =
			next() < 0.65
				? frontier.length - 1
				: Math.floor(next() * frontier.length);
		const node = frontier[index];
		const candidates = shuffle(
			[
				[node[0] + 1, node[1]],
				[node[0] - 1, node[1]],
				[node[0], node[1] + 1],
				[node[0], node[1] - 1],
			].filter(
				([i, j]) =>
					i >= 0 && i < NX && j >= 0 && j < NZ && !seen.has(key(i, j)),
			),
			next,
		);
		const placed = candidates.find((c) => tryAdd(node, c));
		if (placed === undefined) {
			frontier.splice(index, 1);
		} else {
			seen.add(key(...placed));
			frontier.push(placed);
		}
	}
	if (seen.size !== NX * NZ) return { rows: null, reason: "つながらない節点" };
	// 近道の輪を 2〜4 本。
	const loops = 2 + Math.floor(next() * 3);
	let added = 0;
	for (const [a, b] of shuffle(allEdges, next)) {
		if (added >= loops) break;
		if (edges.has(edgeKey(a, b))) continue;
		if (tryAdd(a, b)) added += 1;
	}
	if (added < 2) return { rows: null, reason: "輪を足せない" };

	// 文字地図（迷路の部分）。
	const corridor = corridorGrid(edges);
	const maze = corridor.map((row) => row.map((c) => (c ? "." : "#")));
	const present = (a, b) => edges.has(edgeKey(a, b));

	// 大スロット: 区画ごとに、面した廊下の、区画に接するマスの候補。
	const blocks = [];
	for (let bj = 0; bj < NZ - 1; bj++)
		for (let bi = 0; bi < NX - 1; bi++) {
			const doors = [];
			const xs = [bi * PX + 2, bi * PX + 5];
			const zs = [bj * PZ + 2, bj * PZ + 7];
			if (present([bi, bj], [bi + 1, bj]))
				for (let x = xs[0]; x <= xs[1]; x++) doors.push([x, zs[0] - 1]);
			if (present([bi, bj + 1], [bi + 1, bj + 1]))
				for (let x = xs[0]; x <= xs[1]; x++) doors.push([x, zs[1] + 1]);
			if (present([bi, bj], [bi, bj + 1]))
				for (let z = zs[0]; z <= zs[1]; z++) doors.push([xs[0] - 1, z]);
			if (present([bi + 1, bj], [bi + 1, bj + 1]))
				for (let z = zs[0]; z <= zs[1]; z++) doors.push([xs[1] + 1, z]);
			if (doors.length > 0) blocks.push({ bi, bj, xs, zs, doors });
		}
	const largeMax = Math.min(LARGE[1], blocks.length);
	if (largeMax < LARGE[0])
		return { rows: null, reason: "大スロットが足りない" };
	const largeCount = LARGE[0] + Math.floor(next() * (largeMax - LARGE[0] + 1));
	const chosenBlocks = shuffle(blocks, next)
		.slice(0, largeCount)
		.sort((a, b) => a.bj - b.bj || a.bi - b.bi);

	// 小スロット: つながなかった縦の廊下の跡の両端。襖は、面した節点のマス。
	const smalls = [];
	for (let j = 0; j < NZ - 1; j++)
		for (let i = 0; i < NX; i++) {
			if (present([i, j], [i, j + 1])) continue;
			smalls.push({
				z: j * PZ + 2,
				x: i * PX,
				door: [i * PX + (next() < 0.5 ? 0 : 1), j * PZ + 1],
			});
			smalls.push({
				z: (j + 1) * PZ - 1,
				x: i * PX,
				door: [i * PX + (next() < 0.5 ? 0 : 1), (j + 1) * PZ],
			});
		}
	const smallMax = Math.min(SMALL[1], smalls.length, TOTAL[1] - largeCount);
	const smallMin = Math.max(SMALL[0], TOTAL[0] - largeCount);
	if (smallMax < smallMin)
		return { rows: null, reason: "小スロットが足りない" };
	const smallCount = smallMin + Math.floor(next() * (smallMax - smallMin + 1));
	const chosenSmalls = shuffle(smalls, next)
		.slice(0, smallCount)
		.sort((a, b) => a.z - b.z || a.x - b.x);

	const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const lower = "abcdefghijklmnopqrstuvwxyz";
	chosenBlocks.forEach((block, n) => {
		for (let z = block.zs[0]; z <= block.zs[1]; z++)
			for (let x = block.xs[0]; x <= block.xs[1]; x++) maze[z][x] = upper[n];
		const [dx, dz] = block.doors[Math.floor(next() * block.doors.length)];
		maze[dz][dx] = "+";
	});
	chosenSmalls.forEach((slot, n) => {
		maze[slot.z][slot.x] = lower[n];
		maze[slot.z][slot.x + 1] = lower[n];
		maze[slot.door[1]][slot.door[0]] = "+";
	});

	// 縁側と庭、玄関。
	const left = next() < 0.5;
	const rows = [];
	for (let z = 0; z < MAZE_D; z++) {
		const body = maze[z].join("");
		rows.push(left ? `~==${body}` : `${body}==~`);
	}
	const x0 = left ? 3 : 0;
	const entranceFrom = x0 + (NX >> 1) * PX - 1;
	for (let z = 0; z < ENTRANCE_ROWS; z++) {
		const row = Array(WIDTH).fill("#");
		for (let x = entranceFrom; x < entranceFrom + 5; x++) row[x] = "@";
		rows.push(row.join(""));
	}
	return { rows, reason: null };
}

// --- 検算（skeleton_check.gleam と同じ条件） ---------------------------------------------

/** 文字地図を読む。 */
function parse(rows) {
	const at = (x, z) => rows[z]?.[x] ?? "#";
	const width = rows[0].length;
	const depth = rows.length;
	const walkable = (c) => c === "." || c === "+" || c === "=" || c === "@";
	const slots = new Map();
	for (let z = 0; z < depth; z++)
		for (let x = 0; x < width; x++) {
			const c = at(x, z);
			if (/[A-Za-z]/.test(c)) {
				if (!slots.has(c)) slots.set(c, []);
				slots.get(c).push([x, z]);
			}
		}
	const doorsOf = (cells) => {
		const out = [];
		for (let z = 0; z < depth; z++)
			for (let x = 0; x < width; x++) {
				if (at(x, z) !== "+") continue;
				const touch = cells.find(
					([sx, sz]) => Math.abs(sx - x) + Math.abs(sz - z) === 1,
				);
				if (touch !== undefined) out.push({ corridor: [x, z], slot: touch });
			}
		return out;
	};
	const entrance = [];
	for (let z = 0; z < depth; z++)
		for (let x = 0; x < width; x++) if (at(x, z) === "@") entrance.push([x, z]);
	return { at, width, depth, walkable, slots, doorsOf, entrance };
}

export function check(rows) {
	const map = parse(rows);
	const problems = [];
	// 歩ける道のり（玄関から）。
	const dist = new Map(map.entrance.map(([x, z]) => [`${x},${z}`, 0]));
	const queue = [...map.entrance];
	for (let q = 0; q < queue.length; q++) {
		const [x, z] = queue[q];
		const d = dist.get(`${x},${z}`);
		for (const [nx, nz] of [
			[x + 1, z],
			[x - 1, z],
			[x, z + 1],
			[x, z - 1],
		]) {
			if (!map.walkable(map.at(nx, nz)) || dist.has(`${nx},${nz}`)) continue;
			dist.set(`${nx},${nz}`, d + 1);
			queue.push([nx, nz]);
		}
	}
	let large = 0;
	let small = 0;
	let farthest = 0;
	const doorCells = new Map();
	for (const [id, cells] of map.slots) {
		const xs = cells.map((c) => c[0]);
		const zs = cells.map((c) => c[1]);
		const w = Math.max(...xs) - Math.min(...xs) + 1;
		const d = Math.max(...zs) - Math.min(...zs) + 1;
		const isLarge = id === id.toUpperCase();
		const dims = [w, d].sort((a, b) => a - b).join("x");
		if (cells.length !== w * d || dims !== (isLarge ? "4x6" : "1x2"))
			problems.push(`大きさの違うスロット: ${id}`);
		if (isLarge) large += 1;
		else small += 1;
		const doors = map.doorsOf(cells);
		if (doors.length !== 1) problems.push(`襖が 1 つでないスロット: ${id}`);
		for (const door of doors) {
			const k = door.corridor.join(",");
			doorCells.set(k, (doorCells.get(k) ?? 0) + 1);
			const reached = dist.get(k);
			if (reached === undefined)
				problems.push(`玄関から着けないスロット: ${id}`);
			else farthest = Math.max(farthest, reached);
		}
	}
	for (const [k, n] of doorCells)
		if (n > 1) problems.push(`2 つのスロットに接する襖: ${k}`);
	const straight = straightOf(
		(x, z) => ".+".includes(map.at(x, z)),
		map.width,
		map.depth,
	);
	// 格子の節点の次数。迷路の原点は、廊下のマスのいちばん左上。
	let x0 = Number.POSITIVE_INFINITY;
	let z0 = Number.POSITIVE_INFINITY;
	for (let z = 0; z < map.depth; z++)
		for (let x = 0; x < map.width; x++)
			if (".+".includes(map.at(x, z))) {
				x0 = Math.min(x0, x);
				z0 = Math.min(z0, z);
			}
	const isCorridor = (x, z) => ".+".includes(map.at(x0 + x, z0 + z));
	const degree = new Map();
	for (const [a, b] of allEdges) {
		if (edgeCells(a, b).every(([x, z]) => isCorridor(x, z))) {
			degree.set(key(...a), (degree.get(key(...a)) ?? 0) + 1);
			degree.set(key(...b), (degree.get(key(...b)) ?? 0) + 1);
		}
	}
	const degrees = [...Array(NX * NZ).keys()].map(
		(n) => degree.get(key(n % NX, Math.floor(n / NX))) ?? 0,
	);
	const deadEnds = degrees.filter((d) => d === 1).length;
	const branches = degrees.filter((d) => d >= 3).length;
	const within = (name, value, [min, max]) => {
		if (value < min || value > max)
			problems.push(`${name}: ${value}（${min}〜${max}）`);
	};
	within("大スロット", large, LARGE);
	within("小スロット", small, SMALL);
	within("スロット", large + small, TOTAL);
	within("行き止まり", deadEnds, DEAD_ENDS);
	within("分かれ道", branches, BRANCHES);
	if (straight > STRAIGHT_MAX) problems.push(`まっすぐな廊下: ${straight}`);
	if (farthest > FARTHEST_DOOR_MAX) problems.push(`最も遠い襖: ${farthest}`);
	if (map.width < WIDE_MIN_WIDTH) problems.push(`幅: ${map.width}`);
	const preparation = Math.min(
		50,
		Math.max(30, Math.ceil((farthest / 4.5 + 5) / 5) * 5),
	);
	return {
		problems,
		stats: {
			large,
			small,
			deadEnds,
			branches,
			straight,
			farthest,
			preparation,
			width: map.width,
			depth: map.depth,
			bytes: rows.reduce((sum, row) => sum + row.length, 0),
		},
	};
}

// --- ステージの通知（全スロットに部屋を割り当てたもの。stage_notice.gleam の形） -------------------

function stageNotice(rows) {
	const map = parse(rows);
	const ids = [...map.slots.keys()].sort();
	const regions = { ".": "open", "+": "open", "=": "open", "@": "open" };
	const rooms = {};
	const doors = [];
	for (const id of ids) {
		regions[id] = id;
		rooms[id] = id === id.toUpperCase() ? "washitsu" : "oshiire";
		for (const door of map.doorsOf(map.slots.get(id))) {
			doors.push({
				a: { x: door.corridor[0], z: door.corridor[1] },
				b: { x: door.slot[0], z: door.slot[1] },
				kind: "fusuma",
			});
		}
	}
	const sx = map.entrance.reduce((s, c) => s + c[0], 0) / map.entrance.length;
	const sz = map.entrance.reduce((s, c) => s + c[1], 0) / map.entrance.length;
	return {
		type: "stage",
		cellSize: 1,
		origin: { x: 0, z: 0 },
		width: map.width,
		depth: map.depth,
		rows,
		regions,
		rooms,
		doors,
		spawn: { x: sx + 0.5, z: sz + 0.5 },
	};
}

// --- 書き出し --------------------------------------------------------------------------

function collect() {
	const found = [];
	const seenMaps = new Set();
	for (let seed = 1; found.length < COUNT && seed < 100_000; seed++) {
		const { rows } = build(seed);
		if (rows === null) continue;
		const text = rows.join("\n");
		if (seenMaps.has(text)) continue;
		const result = check(rows);
		if (result.problems.length > 0) continue;
		seenMaps.add(text);
		found.push({ seed, rows, stats: result.stats });
	}
	if (found.length < COUNT)
		throw new Error(`検算を通った地図が ${found.length} 種しかない`);
	return found;
}

function gleamOf(found) {
	const lines = [
		"/// 広い屋敷の骨格 30 種（issue-65 / ADR 0048）。tools/wide_skeletons.mjs で作り、検算",
		"/// （skeleton_check.gleam）を通ったものだけを置く。手で直さない（道具で作り直す）。",
		"///",
		"/// 形式と凡例は skeleton_maps.gleam と同じ（1 文字 = 1 m 四方。行が奥から手前、列が x）。",
		"/// まだどこからも使わない（段階 4 で、2 段の抽選につなぐ）。",
		"pub const maps: List(List(String)) = [",
	];
	for (const entry of found) {
		const s = entry.stats;
		lines.push(
			`  // 種 ${entry.seed}: 大 ${s.large}・小 ${s.small}・行き止まり ${s.deadEnds}・分かれ道 ${s.branches}・まっすぐ ${s.straight} m・最も遠い襖 ${s.farthest} m`,
		);
		lines.push("  [");
		for (const row of entry.rows) lines.push(`    "${row}",`);
		lines.push("  ],");
	}
	lines.push("]");
	return `${lines.join("\n")}\n`;
}

/**
 * 見本のファイルの、既存の stages の文字はそのままに、wideNote と wideStages だけを差し替える（書き直すと、
 * 37.0 が 37 になるなど、既存の部分の文字が変わるため）。
 */
function withWideStages(text, stages) {
	const marker = ',\n\t"wideNote"';
	const base = text.includes(marker)
		? `${text.slice(0, text.indexOf(marker))}\n}\n`
		: text;
	const end = base.lastIndexOf("}");
	const body = base.slice(0, end).trimEnd();
	const note =
		"広い屋敷（issue-65）のはじめの 3 種の、全スロットに部屋を割り当てたときのステージの通知。tools/wide_skeletons.mjs が書き出す。server の stage_notice_test が、サーバーの地図と一致することを確かめる。";
	const wide = JSON.stringify(stages, null, "\t").replaceAll("\n", "\n\t");
	return `${body},\n\t"wideNote": ${JSON.stringify(note)},\n\t"wideStages": ${wide}\n}\n`;
}

const args = process.argv.slice(2);
if (args[0] === "--show") {
	const seed = Number(args[1] ?? 1);
	const { rows, reason } = build(seed);
	if (rows === null) {
		console.log(`種 ${seed}: 作れない（${reason}）`);
	} else {
		console.log(rows.join("\n"));
		console.log(check(rows));
	}
} else {
	const found = collect();
	console.log(
		"| # | 種 | 大 | 小 | 計 | 行き止まり | 分かれ道 | まっすぐ (m) | 最も遠い襖 (m) | 準備移動 (秒) | 幅 x 奥行き | 文字 |",
	);
	console.log(
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	);
	found.forEach((entry, i) => {
		const s = entry.stats;
		console.log(
			`| ${i + 1} | ${entry.seed} | ${s.large} | ${s.small} | ${s.large + s.small} | ${s.deadEnds} | ${s.branches} | ${s.straight} | ${s.farthest} | ${s.preparation} | ${s.width} x ${s.depth} | ${s.bytes} |`,
		);
	});
	if (args[0] !== "--check") {
		writeFileSync(OUT_GLEAM, gleamOf(found));
		writeFileSync(
			OUT_FIXTURE,
			withWideStages(
				readFileSync(OUT_FIXTURE, "utf8"),
				found.slice(0, FIXTURE_COUNT).map((entry) => stageNotice(entry.rows)),
			),
		);
		console.log(
			`\n書き出した: ${OUT_GLEAM}・${OUT_FIXTURE}（wideStages ${FIXTURE_COUNT} 種）`,
		);
	}
}
