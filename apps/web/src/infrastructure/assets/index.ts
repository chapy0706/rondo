/**
 * 素材の読み込みの入口（issue-43 / ADR 0040）。
 *
 * 素材の基準 URL は、ビルド時の環境変数 NEXT_PUBLIC_ASSET_BASE_URL で受け取る（WebSocket の
 * NEXT_PUBLIC_RONDO_WS_URL と同じ扱い。値の直書きはしない）。未設定なら、素材は読み込まず、
 * 各ゲームは仮の表示（箱とカプセル）で動く。素材を使う機能（平屋 issue-46、キャラクター issue-25）
 * は、ここの preloadAsset で読み込みを始め、createSwapSlot で差し替えのタイミングを決める。
 *
 * 平屋の glb は meshopt で圧縮している（issue-55）。MeshoptDecoder は、meshopt を使う glb のときだけ
 * 読み込む（glb.ts）。
 */

import type { Group } from "three";
import { type AudioEntry, audioLoaderOptions, findAudio } from "./audio";
import { createGlbParse } from "./glb";
import { type AssetLoader, createAssetLoader } from "./loader";

export type { FailureReason, LoadResult } from "./loader";
export type { Quality } from "./manifest";
export { createSwapSlot, type SwapSlot } from "./slot";

/** 読み込んだ glb（three の GLTFLoader の結果のシーン）。 */
export interface LoadedGlb {
	readonly scene: Group;
}

let shared: AssetLoader<LoadedGlb> | null = null;

/** 本番のローダー（ブラウザの fetch と、three の GLTFLoader）。1つだけ作って使い回す。 */
function loader(): AssetLoader<LoadedGlb> {
	shared ??= createAssetLoader<LoadedGlb>({
		baseUrl: process.env.NEXT_PUBLIC_ASSET_BASE_URL || undefined,
		fetch: (input, init) => fetch(input, init),
		// three の GLTFLoader と MeshoptDecoder は、素材を使うときだけ読み込む（仮の表示だけなら要らない）。
		parse: createGlbParse({
			loadDecoder: async () =>
				(await import("three/examples/jsm/libs/meshopt_decoder.module.js"))
					.MeshoptDecoder,
			parseGltf: async (data, decoder) => {
				const { GLTFLoader } = await import(
					"three/examples/jsm/loaders/GLTFLoader.js"
				);
				const loader = new GLTFLoader();
				if (decoder !== null) loader.setMeshoptDecoder(decoder);
				const gltf = await loader.parseAsync(data, "");
				// 動き（キャラクターの動きの素材 / issue-57）は、シーンの animations に写して渡す
				// （three の Object3D が持つ欄。ゲームはシーンだけを受け取るため）。
				gltf.scene.animations = gltf.animations;
				return { scene: gltf.scene };
			},
		}),
		// 利用者への警告は出さない。原因は開発者向けに記録する。
		log: (message) => console.info(message),
	});
	return shared;
}

/** 素材を読み込み始める。失敗しても例外は投げず、{ ok: false } で返る。 */
export function preloadAsset(key: string) {
	return loader().load(key);
}

let sharedAudio: AssetLoader<ArrayBuffer> | null = null;

/** 音の素材のローダー（issue-63）。manifest の取得は、glb のローダーと分け合う。 */
function audioLoader(): AssetLoader<ArrayBuffer> {
	sharedAudio ??= createAssetLoader<ArrayBuffer>({
		baseUrl: process.env.NEXT_PUBLIC_ASSET_BASE_URL || undefined,
		fetch: (input, init) => fetch(input, init),
		log: (message) => console.info(message),
		...audioLoaderOptions(loader()),
	});
	return sharedAudio;
}

/**
 * 音の素材を取る（issue-63）。manifest の audio 欄に無い key は、取りに行かず null（いまの本番の
 * manifest には audio 欄が無いので、要求は増えない）。失敗しても例外は投げず null。
 */
export async function loadAudio(
	key: string,
): Promise<{ readonly info: AudioEntry; readonly data: ArrayBuffer } | null> {
	const manifest = await audioLoader().manifest();
	if (manifest === null) return null;
	const info = findAudio(manifest, key);
	if (info === null) return null;
	const result = await audioLoader().load(key);
	return result.ok ? { info, data: result.value } : null;
}
