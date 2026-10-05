/**
 * 素材（glb）の読み込みとフォールバック（issue-43 / ADR 0040）。
 *
 * - 基準 URL が無ければ、何も取りに行かず「仮の表示」を返す
 * - manifest.json を1回だけ取得し、key と品質（既定 512）から素材のパスを引く
 * - glb を取得し、先頭（magic "glTF"・版 2・長さ）を確かめてから、parse（three の GLTFLoader）に渡す
 * - どこで失敗しても（manifest が無い、404、接続できない、壊れた glb、タイムアウト）、例外を投げず
 *   { ok: false, reason } を返す。利用者には警告を出さず、原因は log（console）に記録する
 *
 * fetch・parse・log・時間は注入できるので、テストでは素材なしで確かめられる。
 */

import {
	type AssetManifest,
	type Quality,
	findEntry,
	parseManifest,
} from "./manifest";

export type FailureReason =
	| "disabled"
	| "manifest-unavailable"
	| "not-in-manifest"
	| "http-error"
	| "invalid-glb"
	| "timeout";

export type LoadResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: FailureReason };

export interface AssetLoaderOptions<T = unknown> {
	/** 素材の基準 URL（NEXT_PUBLIC_ASSET_BASE_URL）。未設定なら読み込まない。 */
	readonly baseUrl: string | undefined;
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
	/** glb のバイト列を、表示に使う形にする（本番は three の GLTFLoader）。 */
	readonly parse: (data: ArrayBuffer) => Promise<T>;
	/** 原因の記録（本番は console.info）。 */
	readonly log: (message: string) => void;
	/** 1回の取得の待ち時間の上限（ミリ秒）。 */
	readonly timeoutMs?: number;
	/** 品質。既定 512。 */
	readonly quality?: Quality;
}

export interface AssetLoader<T> {
	load(key: string): Promise<LoadResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const GLB_MAGIC = 0x46546c67;

class Timeout extends Error {}

/** glb の先頭（12 バイトのヘッダ）が正しいか。 */
export function looksLikeGlb(data: ArrayBuffer): boolean {
	if (data.byteLength < 12) return false;
	const view = new DataView(data);
	return (
		view.getUint32(0, true) === GLB_MAGIC &&
		view.getUint32(4, true) === 2 &&
		view.getUint32(8, true) === data.byteLength
	);
}

export function createAssetLoader<T>(
	options: AssetLoaderOptions<T>,
): AssetLoader<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const quality = options.quality ?? 512;
	const base = options.baseUrl?.replace(/\/+$/, "");
	let manifest: Promise<AssetManifest | null> | null = null;
	let toldDisabled = false;

	const fail = (reason: FailureReason, detail: string): LoadResult<T> => {
		options.log(`[assets] ${reason}: ${detail}（仮の表示で続けます）`);
		return { ok: false, reason };
	};

	/** 待ち時間の上限つきで取得する。上限を超えたら中止して Timeout を投げる。 */
	const fetchWithTimeout = async (url: string): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await options.fetch(url, {
				signal: controller.signal,
				// 素材は別オリジン。Cookie などの資格情報は送らない。
				credentials: "omit",
				mode: "cors",
			});
		} catch (error) {
			if (controller.signal.aborted) throw new Timeout(url);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	};

	const getManifest = (): Promise<AssetManifest | null> => {
		manifest ??= (async () => {
			const url = `${base}/manifest.json`;
			try {
				const res = await fetchWithTimeout(url);
				if (!res.ok) {
					fail("manifest-unavailable", `${url} が ${res.status}`);
					return null;
				}
				const parsed = parseManifest(await res.json());
				if (parsed === null) {
					fail("manifest-unavailable", `${url} の形が違う`);
				}
				return parsed;
			} catch (error) {
				fail(
					"manifest-unavailable",
					`${url} を取得できない（${error instanceof Timeout ? "timeout" : String(error)}）`,
				);
				return null;
			}
		})();
		return manifest;
	};

	return {
		async load(key) {
			if (!base) {
				if (!toldDisabled) {
					toldDisabled = true;
					options.log(
						"[assets] disabled: NEXT_PUBLIC_ASSET_BASE_URL が未設定（仮の表示で続けます）",
					);
				}
				return { ok: false, reason: "disabled" };
			}
			const list = await getManifest();
			if (list === null) return { ok: false, reason: "manifest-unavailable" };
			const entry = findEntry(list, key, quality);
			if (entry === null) {
				return fail("not-in-manifest", `${key}（品質 ${quality}）`);
			}

			const url = `${base}/${entry.path}`;
			let data: ArrayBuffer;
			try {
				const res = await fetchWithTimeout(url);
				if (!res.ok) return fail("http-error", `${url} が ${res.status}`);
				data = await res.arrayBuffer();
			} catch (error) {
				if (error instanceof Timeout) {
					return fail("timeout", `${url}（${timeoutMs}ms）`);
				}
				return fail("http-error", `${url} を取得できない（${String(error)}）`);
			}
			if (!looksLikeGlb(data)) {
				return fail("invalid-glb", `${url} の先頭が glb ではない`);
			}
			try {
				return { ok: true, value: await options.parse(data) };
			} catch (error) {
				return fail("invalid-glb", `${url} を読み込めない（${String(error)}）`);
			}
		},
	};
}
