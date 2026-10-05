/**
 * 素材の一覧（manifest.json）の形と検証（issue-43 / ADR 0040）。
 *
 * 配信側（assets-rondo の基準 URL の直下）に置き、アプリが最初に取得する。素材は、ゲームの
 * コードではファイル名ではなく、論理的な名前（key。例: "hiraya-indoor"）で指す。
 * 外から届く値なので、zod で検証してから使う（境界での unknown の検証）。
 */

import { z } from "zod";

/** 品質（テクスチャの長辺の上限 px）。既定は 512。 */
export const QUALITIES = [512, 1024] as const;
export type Quality = (typeof QUALITIES)[number];

const entrySchema = z.object({
	/** 論理的な名前。ゲームのコードはこれで指す。 */
	key: z.string().min(1),
	quality: z.union([z.literal(512), z.literal(1024)]),
	/** 素材の版。パスに入れて、長期キャッシュ（immutable）にする。 */
	version: z.number().int().positive(),
	/** 基準 URL からの相対パス（例: "v1/house/hiraya-indoor-512.glb"）。 */
	path: z
		.string()
		.min(1)
		.refine((p) => !p.startsWith("/") && !p.includes(".."), "相対パスに限る"),
	/** バイト数（目安。読み込みの進み具合や、確認に使う）。 */
	bytes: z.number().int().nonnegative(),
});

export const manifestSchema = z.object({
	/** manifest の形の版。 */
	version: z.literal(1),
	assets: z.array(entrySchema),
});

export type AssetEntry = z.infer<typeof entrySchema>;
export type AssetManifest = z.infer<typeof manifestSchema>;

/** 検証して読む。形が違えば null。 */
export function parseManifest(value: unknown): AssetManifest | null {
	const result = manifestSchema.safeParse(value);
	return result.success ? result.data : null;
}

/** key と品質で引く。 */
export function findEntry(
	manifest: AssetManifest,
	key: string,
	quality: Quality,
): AssetEntry | null {
	return (
		manifest.assets.find((a) => a.key === key && a.quality === quality) ?? null
	);
}
