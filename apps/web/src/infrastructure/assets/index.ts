/**
 * 素材の読み込みの入口（issue-43 / ADR 0040）。
 *
 * 素材の基準 URL は、ビルド時の環境変数 NEXT_PUBLIC_ASSET_BASE_URL で受け取る（WebSocket の
 * NEXT_PUBLIC_RONDO_WS_URL と同じ扱い。値の直書きはしない）。未設定なら、素材は読み込まず、
 * 各ゲームは仮の表示（箱とカプセル）で動く。素材を使う機能（平屋 issue-46、キャラクター issue-25）
 * は、ここの preloadAsset で読み込みを始め、createSwapSlot で差し替えのタイミングを決める。
 */

import type { Group } from "three";
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
		parse: async (data) => {
			// three の GLTFLoader は、素材を使うときだけ読み込む（仮の表示だけなら要らない）。
			const { GLTFLoader } = await import(
				"three/examples/jsm/loaders/GLTFLoader.js"
			);
			const gltf = await new GLTFLoader().parseAsync(data, "");
			return { scene: gltf.scene };
		},
		// 利用者への警告は出さない。原因は開発者向けに記録する。
		log: (message) => console.info(message),
	});
	return shared;
}

/** 素材を読み込み始める。失敗しても例外は投げず、{ ok: false } で返る。 */
export function preloadAsset(key: string) {
	return loader().load(key);
}
