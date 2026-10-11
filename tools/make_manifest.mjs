/**
 * 配信するフォルダの glb から、素材の一覧（manifest.json）を作る（issue-55 / issue-43・ADR 0040）。
 *
 * 使い方:
 *   node tools/make_manifest.mjs assets-src/delivery
 *
 * 入力は、A1 の素材ディレクトリ（/srv/rondo-assets）と同じ形に並べたフォルダ:
 *   <フォルダ>/v1/test/test-cube-512.glb
 *   <フォルダ>/v2/house/hiraya-indoor-512.glb
 *   ...
 * 出力は <フォルダ>/manifest.json（上書きする）。
 *
 * 各項目は、ファイルから計算する:
 *   key      ファイル名の「<key>-<quality>.glb」の key（例: hiraya-indoor）
 *   quality  ファイル名の quality（512 / 1024）
 *   version  パスの先頭の版（v2/... なら 2）
 *   path     フォルダからの相対パス（v<版>/...）
 *   bytes    ファイルの大きさ
 * 同じ key と quality が複数の版にあるときは、いちばん新しい版だけを載せる（古い版のファイルは
 * 残してよい。キャッシュ中の利用者が読み終えられるように）。
 *
 * 形の違うファイル（名前が <key>-<quality>.glb でない、版のフォルダの外にある、glb の先頭が
 * 正しくない）があれば、何も書かずに止まる（終了コード 2）。
 * 素材はリポジトリに入れないので、リポジトリの中では assets-src/ の下だけに書く。
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const QUALITIES = [512, 1024];
const GLB_MAGIC = 0x46546c67;
/** 配信するパスの形（rondo-assets の nginx が配信する形と同じ。deploy/assets/default.conf.template）。 */
const PATH_PATTERN =
	/^v([0-9]+)\/(?:[A-Za-z0-9._-]+\/)*([A-Za-z0-9._-]+)-([0-9]+)\.glb$/;

const [rootArg] = process.argv.slice(2);
if (rootArg === undefined) {
	console.error("使い方: node tools/make_manifest.mjs <配信するフォルダ>");
	process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(rootArg);
const inRepo = root === repo || root.startsWith(repo + sep);
if (inRepo && !root.startsWith(join(repo, "assets-src") + sep)) {
	console.error(
		`停止: リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）: ${root}`,
	);
	process.exit(2);
}

/** フォルダの下の glb すべて（フォルダからの相対パス。区切りは /）。 */
function listGlb(dir) {
	const found = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) found.push(...listGlb(full));
		else if (name.endsWith(".glb")) {
			found.push(relative(root, full).split(sep).join("/"));
		}
	}
	return found;
}

/** glb の先頭（magic "glTF"、版 2、全体の長さ）が正しいか。 */
function looksLikeGlb(path) {
	const data = readFileSync(path);
	return (
		data.length >= 12 &&
		data.readUInt32LE(0) === GLB_MAGIC &&
		data.readUInt32LE(4) === 2 &&
		data.readUInt32LE(8) === data.length
	);
}

const problems = [];
const latest = new Map();
for (const path of listGlb(root).sort()) {
	const match = PATH_PATTERN.exec(path);
	const quality = match ? Number(match[3]) : Number.NaN;
	if (match === null || !QUALITIES.includes(quality)) {
		problems.push(`${path}: v<版>/.../<key>-<512|1024>.glb の形でない`);
		continue;
	}
	const full = join(root, path);
	if (!looksLikeGlb(full)) {
		problems.push(`${path}: glb の先頭（magic・版・長さ）が正しくない`);
		continue;
	}
	const entry = {
		key: match[2],
		quality,
		version: Number(match[1]),
		path,
		bytes: statSync(full).size,
	};
	if (entry.version < 1) {
		problems.push(`${path}: 版は 1 以上`);
		continue;
	}
	const id = `${entry.key}@${entry.quality}`;
	const kept = latest.get(id);
	if (kept !== undefined && kept.version === entry.version) {
		problems.push(`${path}: ${kept.path} と同じ key・quality・版`);
		continue;
	}
	if (kept === undefined || kept.version < entry.version) latest.set(id, entry);
}

if (problems.length > 0) {
	console.error("停止: manifest.json は書いていない");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(2);
}
if (latest.size === 0) {
	console.error(`停止: ${root} の下に v<版>/ の glb が無い`);
	process.exit(2);
}

const assets = [...latest.values()].sort(
	(a, b) => a.key.localeCompare(b.key) || a.quality - b.quality,
);
const output = join(root, "manifest.json");
writeFileSync(
	output,
	`${JSON.stringify({ version: 1, assets }, null, "\t")}\n`,
);

console.log(`書いた: ${output}`);
console.log("key\tquality\tversion\tbytes\tpath");
for (const a of assets) {
	console.log(`${a.key}\t${a.quality}\t${a.version}\t${a.bytes}\t${a.path}`);
}
