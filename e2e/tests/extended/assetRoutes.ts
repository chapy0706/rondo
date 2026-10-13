/**
 * 素材の配信の差し替え（issue-52）。拡張の E2E（playwright.extended.config.ts）は、web の素材の基準 URL を
 * 実在しないホスト（ASSET_BASE_URL）にして起動し、テストごとに、そのホストへのリクエストを
 * page.route で差し替える（404、壊れた glb、応答しない、manifest の欠落、正常）。
 *
 * 正常のときに配る素材は、ここで組み立てる小さな glb（骨 2 本の板の体と、ポーズの表だけの glb）。
 * 本素材（X Bot など）は使わない（リポジトリに入れないため。素材が無い端末でも流せる）。
 */

import type { Page, Route } from "@playwright/test";

/** 素材の基準 URL（実在しないホスト。リクエストはすべて page.route で差し替える）。 */
export const ASSET_BASE_URL = "http://assets.e2e.invalid";

const CORS = { "access-control-allow-origin": "*" };

/** キャラクターの体とポーズの表だけを載せた manifest（動きは載せない。省略できる素材）。 */
export const MANIFEST = {
	version: 1,
	assets: [512, 1024].flatMap((quality) => [
		{
			key: "character-body",
			quality,
			version: 1,
			path: `v1/e2e/character-body-${quality}.glb`,
			bytes: 1,
		},
		{
			key: "character-poses",
			quality,
			version: 1,
			path: `v1/e2e/character-poses-${quality}.glb`,
			bytes: 1,
		},
	]),
};

/** 配信の振る舞い。 */
export type AssetBehavior =
	| "ok"
	| "glb-404"
	| "broken-glb"
	| "glb-timeout"
	| "manifest-missing";

/**
 * このページの素材のリクエストを、behavior のとおりに差し替える。glb-timeout は glb に応答しない
 * （web のローダーの待ち時間の上限で、中止される）。
 */
export async function serveAssets(
	page: Page,
	behavior: AssetBehavior,
): Promise<void> {
	await page.route(`${ASSET_BASE_URL}/**`, async (route: Route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/manifest.json") {
			if (behavior === "manifest-missing") {
				await route.fulfill({ status: 404, headers: CORS, body: "" });
				return;
			}
			await route.fulfill({ status: 200, headers: CORS, json: MANIFEST });
			return;
		}
		const isBody = url.pathname.includes("character-body");
		const isPoses = url.pathname.includes("character-poses");
		if (!isBody && !isPoses) {
			await route.fulfill({ status: 404, headers: CORS, body: "" });
			return;
		}
		switch (behavior) {
			case "glb-404":
				await route.fulfill({ status: 404, headers: CORS, body: "" });
				return;
			case "broken-glb":
				await route.fulfill({
					status: 200,
					headers: { ...CORS, "content-type": "model/gltf-binary" },
					body: Buffer.from("これは glb ではない"),
				});
				return;
			case "glb-timeout":
				// 応答しない（ページ側の中止で終わる）。
				return;
			default:
				await route.fulfill({
					status: 200,
					headers: { ...CORS, "content-type": "model/gltf-binary" },
					body: isBody ? TINY_BODY_GLB : TINY_POSES_GLB,
				});
		}
	});
}

// --- 小さな glb ---------------------------------------------------------------------

/** glTF の JSON と、バイナリ（無くてよい）から glb を作る。 */
function glb(json: unknown, bin: Buffer | null): Buffer {
	const pad = (data: Buffer, fill: number) => {
		const extra = (4 - (data.length % 4)) % 4;
		return Buffer.concat([data, Buffer.alloc(extra, fill)]);
	};
	const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
	const chunks = [{ type: 0x4e4f534a, data: jsonChunk }];
	if (bin !== null) chunks.push({ type: 0x004e4942, data: pad(bin, 0) });
	const length =
		12 + chunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0);
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(length, 8);
	return Buffer.concat([
		header,
		...chunks.flatMap((chunk) => {
			const head = Buffer.alloc(8);
			head.writeUInt32LE(chunk.data.length, 0);
			head.writeUInt32LE(chunk.type, 4);
			return [head, chunk.data];
		}),
	]);
}

/**
 * 骨 2 本（Hips が根、Spine が子で 1 m 上）と、縦長の板（幅 0.6 m、高さ 2 m）のスキンつきメッシュ。
 * 下の 4 頂点は Hips、上の 2 頂点は Spine に付く（apps/web の body.test.ts の小さな体と同じ形）。
 */
function tinyBody(): Buffer {
	const positions = new Float32Array([
		-0.3, 0, 0, 0.3, 0, 0, -0.3, 1, 0, 0.3, 1, 0, -0.3, 2, 0, 0.3, 2, 0,
	]);
	const joints = new Uint16Array([
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
	]);
	const weights = new Float32Array([
		1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
	]);
	const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
	// 逆バインド行列（列の順）。Hips は原点、Spine は y = 1。
	const inverseBind = new Float32Array([
		1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
		0, 1, 0, 0, -1, 0, 1,
	]);
	const parts = [positions, joints, weights, indices, inverseBind].map(
		(array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength),
	);
	const views: { byteOffset: number; byteLength: number }[] = [];
	let offset = 0;
	for (const part of parts) {
		views.push({ byteOffset: offset, byteLength: part.length });
		offset += part.length + ((4 - (part.length % 4)) % 4);
	}
	const bin = Buffer.concat(
		parts.flatMap((part) => [part, Buffer.alloc((4 - (part.length % 4)) % 4)]),
	);
	const json = {
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0, 2] }],
		nodes: [
			{ name: "mixamorig:Hips", children: [1] },
			{ name: "mixamorig:Spine", translation: [0, 1, 0] },
			{ name: "Body", mesh: 0, skin: 0 },
		],
		skins: [{ joints: [0, 1], inverseBindMatrices: 4 }],
		meshes: [
			{
				primitives: [
					{
						attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
						indices: 3,
					},
				],
			},
		],
		accessors: [
			{
				bufferView: 0,
				componentType: 5126,
				count: 6,
				type: "VEC3",
				min: [-0.3, 0, 0],
				max: [0.3, 2, 0],
			},
			{ bufferView: 1, componentType: 5123, count: 6, type: "VEC4" },
			{ bufferView: 2, componentType: 5126, count: 6, type: "VEC4" },
			{ bufferView: 3, componentType: 5123, count: 12, type: "SCALAR" },
			{ bufferView: 4, componentType: 5126, count: 2, type: "MAT4" },
		],
		bufferViews: views.map((view, i) => ({
			buffer: 0,
			...view,
			...(i < 3 ? { target: 34962 } : i === 3 ? { target: 34963 } : {}),
		})),
		buffers: [{ byteLength: bin.length }],
	};
	return glb(json, bin);
}

/** ポーズの表だけの glb（scene の extras に表。apps/web の bodyPose.ts の形）。 */
function tinyPoses(): Buffer {
	const still = {
		t: [
			[0, 0, 0],
			[0, 1, 0],
		],
		r: [
			[0, 0, 0, 1],
			[0, 0, 0, 1],
		],
		min: [-0.3, 0, 0],
		max: [0.3, 2, 0],
	};
	return glb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [
				{
					extras: {
						rondoPoses: {
							version: 1,
							standingHeight: 2,
							bindMin: [-0.3, 0, 0],
							bindMax: [0.3, 2, 0],
							joints: ["mixamorig:Hips", "mixamorig:Spine"],
							poses: { idle: still },
						},
					},
				},
			],
		},
		null,
	);
}

const TINY_BODY_GLB = tinyBody();
const TINY_POSES_GLB = tinyPoses();
