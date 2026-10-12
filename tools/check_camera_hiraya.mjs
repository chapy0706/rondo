/**
 * 平屋のカメラのめり込みを、実データで全探索する（issue-46 の続き。手元で実行する）。
 *
 * 使い方:
 *   node tools/check_camera_hiraya.mjs
 *   node tools/check_camera_hiraya.mjs assets-src/delivery/v2/house/hiraya-furniture-512.glb
 *
 * 自動テストの全探索（apps/web/src/games/veryare/cameraGuard.test.ts の (a)）と同じ判定
 * （cameraCheck.ts の cameraProblems）を、実際の平屋のデータで流す。
 * - 地図: 平屋の共有の見本（packages/contracts/src/fixtures/veryare-hiraya-stage.json）
 * - 家具の箱: 家具の glb（tools/furniture_boxes.mjs で作ったもの）を three の GLTFLoader で読み、
 *   クライアントと同じ検証（furniture.ts の parseFurniture）を通したもの
 * - 体の位置: 歩けるマスの中心と、マスの4つの辺のすぐ内側。足もとはそこの床の高さ（hiraya.ts）
 * - 視点の向き: 16 方向
 * カメラの置き方は、クライアントと同じ（cameraGuard.ts の allowedCameraReach と placeGuardedCamera）。
 *
 * 出力: めり込む場所の一覧（部屋、座標、向き、問題と近い物の名前）と、件数。めり込み（領域の外・
 * 壁・家具の箱の中・家具に近い）が 0 件なら終了コード 0、1 件以上なら 1。読めなければ 2。
 * 家具が体を隠す場所（体が家具の下や中に入り込んで、その向きではどこに置いても隠れる）は、
 * めり込みとは別に、件数と場所を出す（--hidden で一覧も出す）。
 *
 * アプリの TypeScript を、そのまま Node（型の取り除き）で読む。アプリの相対の読み込みは拡張子を
 * 書かないので、読み込みの解決で .ts を補う（このファイルの中で登録する）。入力は読むだけ。
 */

import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const showHidden = args.includes("--hidden");
const [furnitureArg] = args.filter((a) => !a.startsWith("--"));
const furniturePath = resolve(
	furnitureArg ??
		join(repo, "assets-src/delivery/v2/house/hiraya-furniture-512.glb"),
);

// 拡張子の無い相対の読み込み（"./stage" など）に .ts を補う。
const hook = `
export async function resolve(specifier, context, next) {
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.[a-z]+$/.test(specifier)) {
		try { return await next(specifier + ".ts", context); } catch {}
	}
	return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const app = (path) =>
	import(pathToFileURL(join(repo, "apps/web/src/games/veryare", path)).href);
const { parseStageNotice } = await app("stage.ts");
const { floorHeight } = await app("hiraya.ts");
const { allowedCameraReach, placeGuardedCamera } = await app("cameraGuard.ts");
const { cameraProblems, problemText } = await app("cameraCheck.ts");
const { parseFurniture } = await app("furniture.ts");
const { GLTFLoader } = await import(
	pathToFileURL(
		join(
			repo,
			"apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js",
		),
	).href
);

const fixture = JSON.parse(
	readFileSync(
		join(repo, "packages/contracts/src/fixtures/veryare-hiraya-stage.json"),
		"utf8",
	),
);
const grid = parseStageNotice(fixture.stage);
if (grid === null) {
	console.error("停止: 平屋の見本を読めない");
	process.exit(2);
}

let boxes;
try {
	const data = readFileSync(furniturePath);
	const buffer = data.buffer.slice(
		data.byteOffset,
		data.byteOffset + data.byteLength,
	);
	const gltf = await new GLTFLoader().parseAsync(buffer, "");
	boxes = parseFurniture(gltf.scene.userData);
} catch (error) {
	console.error(`停止: 家具の glb を読めない（${furniturePath}）: ${error}`);
	process.exit(2);
}
if (boxes === null) {
	console.error(`停止: 家具の glb の箱の一覧の形が違う（${furniturePath}）`);
	process.exit(2);
}

/** 領域の文字 → 部屋の名前（hiraya.gleam の regions の説明と同じ）。 */
const ROOM_NAMES = {
	"=": "縁側",
	":": "広縁",
	".": "東の廊下",
	"@": "玄関",
	A: "和室A",
	B: "和室B",
	C: "和室C",
	D: "ダイニング",
	K: "キッチン",
	F: "風呂",
	W: "洗面所",
	T: "トイレ",
	o: "押入れ",
};

const edge = grid.cellSize / 2 - 0.002;
const lines = [];
const hiddenLines = [];
const byKind = new Map();
const byRoom = new Map();
const hiddenByRoom = new Map();
let checked = 0;
for (let z = 0; z < grid.depth; z++) {
	for (let x = 0; x < grid.width; x++) {
		const char = grid.charAt({ x, z });
		if (grid.regionAt({ x, z }) === null) continue;
		const cx = grid.origin.x + grid.cellSize * (x + 0.5);
		const cz = grid.origin.z + grid.cellSize * (z + 0.5);
		for (const body of [
			{ x: cx, z: cz },
			{ x: cx + edge, z: cz },
			{ x: cx - edge, z: cz },
			{ x: cx, z: cz + edge },
			{ x: cx, z: cz - edge },
		]) {
			const feet = floorHeight(grid, body, true);
			const center = { ...body, feet };
			for (let k = 0; k < 16; k++) {
				const yaw = (k / 16) * 2 * Math.PI;
				const reach = allowedCameraReach(grid, center, yaw, boxes);
				const pose = placeGuardedCamera(grid, center, yaw, reach, boxes);
				checked += 1;
				for (const problem of cameraProblems(
					grid,
					body,
					feet,
					pose.position,
					boxes,
				)) {
					const room = ROOM_NAMES[char] ?? char;
					const line = [
						room,
						`マス (${x}, ${z})`,
						`体 (${body.x.toFixed(3)}, ${body.z.toFixed(3)})`,
						`向き ${k * 22.5}°`,
						problemText(problem),
					].join("\t");
					if (problem.kind === "hides") {
						hiddenLines.push(line);
						hiddenByRoom.set(room, (hiddenByRoom.get(room) ?? 0) + 1);
						continue;
					}
					lines.push(line);
					byKind.set(problem.kind, (byKind.get(problem.kind) ?? 0) + 1);
					byRoom.set(room, (byRoom.get(room) ?? 0) + 1);
				}
			}
		}
	}
}

for (const line of lines) console.log(line);
if (showHidden) for (const line of hiddenLines) console.log(line);
console.log(
	`確かめた: ${checked} 通り（家具の箱 ${boxes.length} 個）。めり込む場所: ${lines.length} 件`,
);
console.log(
	`家具が体を隠す場所（めり込みではない）: ${hiddenLines.length} 件${hiddenLines.length > 0 ? `（${[...hiddenByRoom].map(([r, n]) => `${r} ${n}`).join("、")}。一覧は --hidden）` : ""}`,
);
if (lines.length > 0) {
	console.log(
		`種類ごと: ${[...byKind].map(([k, n]) => `${k} ${n}`).join("、")}`,
	);
	console.log(
		`部屋ごと: ${[...byRoom].map(([r, n]) => `${r} ${n}`).join("、")}`,
	);
}
process.exit(lines.length === 0 ? 0 : 1);
