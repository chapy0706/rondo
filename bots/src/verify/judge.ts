/**
 * デプロイ後の自動確認（issue-50）の、応答の判定。副作用を持たない純粋関数だけを置き、
 * テストを先に書く。HTTP の取得は checks.ts が行い、ここには取った値だけを渡す。
 *
 * 外から届いた値（manifest.json の本文、env ファイルの中身）は unknown / 文字列として受け取り、
 * ここで形を確かめてから使う（境界での検証）。
 */

import type { Attempt } from "./report.ts";

/** web: 200、HTML、<title> に期待の文字列が入っている。 */
export function judgeWeb(
	status: number,
	contentType: string,
	body: string,
	expectedTitle: string,
): Attempt {
	const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? "";
	const ok =
		status === 200 &&
		contentType.includes("text/html") &&
		title.includes(expectedTitle);
	return {
		ok,
		detail: `${status} ${contentType || "(型なし)"} title=${title || "(なし)"}`,
	};
}

/** manifest.json: 200、CORS が許可したオリジン、cache-control が max-age=60（deploy/assets）。 */
export function judgeManifest(
	status: number,
	allowOrigin: string,
	cacheControl: string,
	expectedOrigin: string,
): Attempt {
	const ok =
		status === 200 &&
		allowOrigin === expectedOrigin &&
		cacheControl.includes("max-age=60");
	return {
		ok,
		detail: `${status} CORS=${allowOrigin || "(なし)"} cache=${cacheControl || "(なし)"}`,
	};
}

/**
 * glb: 1回目が 200・model/gltf-binary・immutable。2回目の cf-cache-status が HIT
 * （Cloudflare の Cache Rules が効いている。docs/deploy.md の素材の配信の手順 5）。
 * 1回目が MISS で、2回目が HIT になるのがふつうの形。2回目も MISS なら、ルールが効いていない。
 */
export function judgeGlb(
	status: number,
	contentType: string,
	cacheControl: string,
	secondCfCacheStatus: string | null,
): Attempt {
	const headOk =
		status === 200 &&
		contentType.includes("model/gltf-binary") &&
		cacheControl.includes("immutable");
	const cf = secondCfCacheStatus?.toUpperCase() ?? null;
	const cacheOk = cf === "HIT";
	const cfText = cf ?? "(なし。Cloudflare を通っていない)";
	return {
		ok: headOk && cacheOk,
		detail: `${status} ${contentType || "(型なし)"} cache=${cacheControl || "(なし)"} 2回目のcf-cache-status=${cfText}`,
	};
}

/** 版付きのパス（v1/...glb）。nginx が配信する形と同じ（deploy/assets/default.conf.template）。 */
const ASSET_PATH = /^v[0-9]+\/[A-Za-z0-9._\-/]+\.glb$/;

/**
 * manifest.json の本文から、いちばん小さい素材のパスを選ぶ（確認で大きな素材を落とさないため）。
 * 形が違う、または版付きのパスが1つも無ければ null。
 */
export function smallestAssetPath(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const assets: unknown = (body as { assets?: unknown }).assets;
	if (!Array.isArray(assets)) return null;
	let best: { path: string; bytes: number } | null = null;
	for (const item of assets as unknown[]) {
		if (typeof item !== "object" || item === null) continue;
		const { path, bytes } = item as { path?: unknown; bytes?: unknown };
		if (typeof path !== "string" || !ASSET_PATH.test(path)) continue;
		if (path.includes("..")) continue;
		const size =
			typeof bytes === "number" && Number.isFinite(bytes)
				? bytes
				: Number.POSITIVE_INFINITY;
		if (best === null || size < best.bytes) best = { path, bytes: size };
	}
	return best?.path ?? null;
}

/**
 * env ファイルの中身から、指定した名前の値だけを取り出す（ほかの行は読まない・返さない）。
 * 実行（source）はしない。同じ名前が複数あれば最後の行。前後の引用符は外す。空の値は返さない。
 */
export function readEnvValues(
	text: string,
	names: readonly string[],
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const name = line.slice(0, eq).trim();
		if (!names.includes(name)) continue;
		const value = unquote(line.slice(eq + 1).trim());
		if (value === "") delete values[name];
		else values[name] = value;
	}
	return values;
}

function unquote(value: string): string {
	for (const quote of ['"', "'"]) {
		if (value.length >= 2 && value.startsWith(quote) && value.endsWith(quote))
			return value.slice(1, -1);
	}
	return value;
}
