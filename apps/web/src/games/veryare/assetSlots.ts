/**
 * veryare の素材の入口（issue-46 / issue-43・ADR 0040）。素材のローダー（preloadAsset）と差し替え口
 * （createSwapSlot）を呼ぶのは、ここだけにする。
 *
 * - 平屋（issue-46）: 屋内本体・屋外の飾り・屋根と天井・家具の箱の4つの glb を読み、1つの差し替え口に
 *   まとめる。屋内本体が読めなければ全体を仮の表示（箱）にし、屋外の飾り・屋根・家具の箱は、読めた
 *   ものだけ使う。家具の箱の glb はメッシュを持たず、scene の extras に箱の一覧だけを入れたもの
 *   （カメラの守り / furniture.ts・cameraGuard.ts）
 * - 先読み: 平屋の選択肢を出すときは、ロビーを開いた時点で読み込みを始める（prefetchLobbyAssets）。
 *   読み込みは1回だけで、その結果は、最初の対戦の差し替え口がそのまま使う。ロビーを離れても
 *   捨てない。2回目以降の対戦は、新しい差し替え口で読み直す（ブラウザのキャッシュから届く）。
 *   前の対戦の後片付けで three のメッシュを解放するため、同じものを使い回さない
 * - 入口は画面全体で1つ（gameAssets）。ロビーとゲームの画面が同じものを使う
 * - キャラクター（issue-56）: 体（X Bot）とポーズの表の2つの glb を読み、1つの差し替え口にまとめる。
 *   どちらかが読めなければ、仮のカプセルのまま（警告は出さない）。対戦の画面を開いた時点で読み始め、
 *   待機ルームにいる間に差し替える（シーンの bodies の受け口）
 *
 * 差し替えるのは、待機ルームにいる間だけ（シーンが take() し、ステージへ移ったら lock() する）。
 * 間に合わなければ、その回は仮の表示のまま。読み込みの失敗は警告を出さない（ローダーが記録する）。
 */

import type { Group } from "three";
import {
	type LoadResult,
	type LoadedGlb,
	type SwapSlot,
	createSwapSlot,
	preloadAsset,
} from "../../infrastructure/assets";
import { type AssetEvent, devTrace, manifestStatus } from "./assetTrace";

/** 平屋の素材の key（manifest.json の key。docs/assets.md）。 */
export const HIRAYA_KEYS = {
	indoor: "hiraya-indoor",
	outdoor: "hiraya-outdoor",
	roof: "hiraya-roof",
	furniture: "hiraya-furniture",
} as const;

/** キャラクターの素材の key（issue-56）。 */
export const CHARACTER_KEYS = {
	body: "character-body",
	poses: "character-poses",
} as const;

/** キャラクターの2つの glb（体と、ポーズの表）。 */
export interface CharacterParts<T> {
	readonly body: T;
	readonly poses: T;
}

/** 2つの読み込みの結果を1つにまとめる。どちらかが読めなければ、その失敗のまま（体を先に見る）。 */
export function combineCharacter<T>(
	body: LoadResult<T>,
	poses: LoadResult<T>,
): LoadResult<CharacterParts<T>> {
	if (!body.ok) return body;
	if (!poses.ok) return poses;
	return { ok: true, value: { body: body.value, poses: poses.value } };
}

/** 平屋の4つの glb。屋外の飾り・屋根・家具の箱は、読めなければ null。 */
export interface HirayaParts<T> {
	readonly indoor: T;
	readonly outdoor: T | null;
	readonly roof: T | null;
	readonly furniture: T | null;
}

/** 表示に使う平屋（three のシーンのまま。座標は glb の座標 = ステージの座標）。 */
export type HirayaModel = HirayaParts<Group>;

/** 4つの読み込みの結果を1つにまとめる。屋内本体が読めなければ、その失敗のまま。 */
export function combineHiraya<T>(
	indoor: LoadResult<T>,
	outdoor: LoadResult<T>,
	roof: LoadResult<T>,
	furniture: LoadResult<T>,
): LoadResult<HirayaParts<T>> {
	if (!indoor.ok) return indoor;
	return {
		ok: true,
		value: {
			indoor: indoor.value,
			outdoor: outdoor.ok ? outdoor.value : null,
			roof: roof.ok ? roof.value : null,
			furniture: furniture.ok ? furniture.value : null,
		},
	};
}

export interface VeryareAssets<T> {
	/** 平屋の読み込みを始めておく（ロビー）。まだ使っていない先読みがあれば、何もしない。 */
	prefetchHiraya(): void;
	/**
	 * 対戦1回ぶんの、平屋の差し替え口。使っていない先読みがあればその結果を使い、無ければ
	 * 読み込みを始める。呼ぶたびに新しい差し替え口を返す。
	 */
	hirayaSlot(): SwapSlot<HirayaParts<T>>;
	/** 対戦1回ぶんの、キャラクターの差し替え口（呼ぶたびに読み込みを始める）。 */
	characterSlot(): SwapSlot<CharacterParts<T>>;
}

/**
 * preload は差し替えられる（テスト用）。本番は gameAssets を使う。trace は素材の流れの記録
 * （開発中だけ Console に出す / assetTrace.ts）。
 */
export function createVeryareAssets<T>(
	preload: (key: string) => Promise<LoadResult<T>>,
	trace: (event: AssetEvent) => void = () => undefined,
): VeryareAssets<T> {
	const keys = [
		HIRAYA_KEYS.indoor,
		HIRAYA_KEYS.outdoor,
		HIRAYA_KEYS.roof,
		HIRAYA_KEYS.furniture,
	];
	const load = () =>
		Promise.all(keys.map((key) => preload(key))).then((results) => {
			trace({ kind: "manifest", status: manifestStatus(results) });
			results.forEach((result, index) => {
				trace({
					kind: "load",
					key: keys[index] ?? "",
					ok: result.ok,
					...(result.ok ? {} : { reason: result.reason }),
				});
			});
			const [indoor, outdoor, roof, furniture] = results as [
				LoadResult<T>,
				LoadResult<T>,
				LoadResult<T>,
				LoadResult<T>,
			];
			return combineHiraya(indoor, outdoor, roof, furniture);
		});
	/** 先読みして、まだ差し替え口に渡していない読み込み。 */
	let prefetched: Promise<LoadResult<HirayaParts<T>>> | null = null;
	return {
		prefetchHiraya() {
			prefetched ??= load();
		},
		hirayaSlot() {
			trace({ kind: "slot", from: prefetched === null ? "new" : "prefetch" });
			const pending = prefetched ?? load();
			prefetched = null;
			return createSwapSlot(pending);
		},
		characterSlot() {
			const pending = Promise.all([
				preload(CHARACTER_KEYS.body),
				preload(CHARACTER_KEYS.poses),
			]).then(([body, poses]) => {
				trace({
					kind: "load",
					key: CHARACTER_KEYS.body,
					ok: body.ok,
					...(body.ok ? {} : { reason: body.reason }),
				});
				trace({
					kind: "load",
					key: CHARACTER_KEYS.poses,
					ok: poses.ok,
					...(poses.ok ? {} : { reason: poses.reason }),
				});
				return combineCharacter(body, poses);
			});
			return createSwapSlot(pending);
		},
	};
}

/** ロビーを開いた時点の先読み。平屋の選択肢を出すとき（enabled）だけ始める。 */
export function prefetchLobbyAssets<T>(
	enabled: boolean,
	assets: VeryareAssets<T>,
): void {
	if (enabled) assets.prefetchHiraya();
}

let shared: VeryareAssets<Group> | null = null;

/** 本番の入口（素材の配信から読み、three のシーンを取り出す）。画面全体で1つ。 */
export function gameAssets(): VeryareAssets<Group> {
	shared ??= createVeryareAssets(async (key) => {
		const result: LoadResult<LoadedGlb> = await preloadAsset(key);
		return result.ok ? { ok: true, value: result.value.scene } : result;
	}, devTrace);
	return shared;
}
