/**
 * 音の素材（issue-63）: manifest の audio 欄の形と、音のファイルの読み込みの設定。
 *
 * audio 欄の項目:
 *   key         論理的な名前（bgm-top など。platform/sound/keys.ts）
 *   kind        bgm（繰り返す）か se（効果音）
 *   version     素材の版（パスに入れて、長期キャッシュ）
 *   path        基準 URL からの相対パス（例: "v1/audio/bgm-top.mp3"）
 *   bytes       バイト数
 *   durationMs  長さ（鳴らし方を決める。tools/audio_assets.mjs が測る）
 *   gain        倍率（音量をそろえる。素材を作り直さずに変える）
 *   loop        繰り返しの位置と重なり（BGM と、繰り返す効果音。無ければ全体を重なりなしで）
 *
 * 外から届く値なので、項目ごとに zod で検証し、形の違う項目は捨てる（glb の素材を巻き込まない）。
 */

import { z } from "zod";
import type { AssetLoader, AssetLoaderOptions } from "./loader";
import type { AssetManifest } from "./manifest";

const loopSchema = z
	.object({
		startMs: z.number().int().nonnegative(),
		endMs: z.number().int().positive(),
		crossfadeMs: z.number().int().nonnegative(),
	})
	.refine(
		(loop) => loop.endMs > loop.startMs + loop.crossfadeMs,
		"終わりは、始まりと重なりより後",
	);

const audioEntrySchema = z.object({
	key: z.string().min(1),
	kind: z.enum(["bgm", "se"]),
	version: z.number().int().positive(),
	path: z
		.string()
		.min(1)
		.refine((p) => !p.startsWith("/") && !p.includes(".."), "相対パスに限る"),
	bytes: z.number().int().nonnegative(),
	durationMs: z.number().int().positive(),
	gain: z.number().positive().max(4),
	loop: loopSchema.optional(),
});

export type AudioEntry = z.infer<typeof audioEntrySchema>;

/** key で引く。audio 欄が無い・その項目の形が違うなら null。 */
export function findAudio(
	manifest: AssetManifest,
	key: string,
): AudioEntry | null {
	const list: unknown = manifest.audio;
	if (!Array.isArray(list)) return null;
	for (const item of list as unknown[]) {
		const result = audioEntrySchema.safeParse(item);
		if (result.success && result.data.key === key) return result.data;
	}
	return null;
}

/** 音のファイルの先頭か（ID3 の札、MP3 のフレームの頭、mp4 の ftyp）。 */
export function looksLikeAudio(data: ArrayBuffer): boolean {
	if (data.byteLength < 4) return false;
	const bytes = new Uint8Array(data, 0, Math.min(8, data.byteLength));
	const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
	const frame = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
	const mp4 =
		bytes.length >= 8 &&
		bytes[4] === 0x66 &&
		bytes[5] === 0x74 &&
		bytes[6] === 0x79 &&
		bytes[7] === 0x70;
	return id3 || frame || mp4;
}

/**
 * 音の素材のローダーの設定。manifest は glb のローダー（shared）と 1 回の取得を分け合う。
 * バイト列は、そのまま返す（展開は、鳴らす側が、要るときに行う）。
 */
export function audioLoaderOptions(
	shared: AssetLoader<unknown>,
): Pick<
	AssetLoaderOptions<ArrayBuffer>,
	"parse" | "verify" | "invalidReason" | "select" | "manifest"
> {
	return {
		parse: async (data) => data,
		verify: looksLikeAudio,
		invalidReason: "invalid-audio",
		select: (manifest, key) => findAudio(manifest, key),
		manifest: () => shared.manifest(),
	};
}
