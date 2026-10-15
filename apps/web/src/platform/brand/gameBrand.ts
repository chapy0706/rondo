/**
 * ゲームの表示名とロゴ（issue-69）。登録（manifest.ts）から引くだけの純粋な関数。
 *
 * - 表示名は、登録の title（日本語名）。読み上げと画像の代替の文字は、spokenTitle があればそれ
 *   （テ〇〇ス → 落ちものパズル）、無ければ表示名
 * - ロゴの画像は、登録の logo.src。無ければ、仮のタイル（ゲームの背景の色と、表示名の頭文字）を出す。
 *   画像が読めないときも、タイルが見える（画面の側で、画像を隠す）
 * - 内部の識別子（id = gameType）は、ここでは変えない
 */

import type { GameManifest } from "@rondo/contracts";

/** 背景の色が無い・正しくないときの、仮のタイルの色（globals.css の --color-surface）。 */
export const DEFAULT_TILE_BACKGROUND = "#1e1b2e";

/** 暗い背景の上の文字の色と、明るい背景の上の文字の色（--color-ink）。 */
const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#13111f";

/** 画面に出す名前。空なら識別子（空の名前を出さない）。 */
export function displayName(manifest: GameManifest): string {
	const name = manifest.title.trim();
	return name === "" ? manifest.id : name;
}

/** 読み上げ（aria-label）と、画像の代替の文字（alt）。 */
export function spokenName(manifest: GameManifest): string {
	const spoken = manifest.spokenTitle?.trim() ?? "";
	return spoken === "" ? displayName(manifest) : spoken;
}

/** ロゴの画像。無ければ null（仮のタイルを出す）。 */
export function logoOf(
	manifest: GameManifest,
): { readonly src: string; readonly alt: string } | null {
	const src = manifest.logo?.src?.trim() ?? "";
	return src === "" ? null : { src, alt: spokenName(manifest) };
}

/** 仮のタイル。背景はゲームの色、文字は表示名の頭文字、文字の色は背景の明るさで決める。 */
export function tileOf(manifest: GameManifest): {
	readonly background: string;
	readonly foreground: string;
	readonly initial: string;
} {
	const color = manifest.logo?.background ?? "";
	const background = /^#[0-9a-fA-F]{6}$/.test(color)
		? color.toLowerCase()
		: DEFAULT_TILE_BACKGROUND;
	const [first] = Array.from(displayName(manifest));
	return {
		background,
		foreground: isLight(background) ? DARK_TEXT : LIGHT_TEXT,
		initial: (first ?? "?").toUpperCase(),
	};
}

/**
 * 画面に出すもの。いつもタイルを敷き、画像があって読めていれば（failed でなければ）上に重ねる。
 * 画像が読めなかったら（failed）、画像を隠してタイルだけにする。
 */
export function logoView(
	manifest: GameManifest,
	failed: boolean,
): {
	readonly tile: ReturnType<typeof tileOf>;
	readonly image: ReturnType<typeof logoOf>;
} {
	return { tile: tileOf(manifest), image: failed ? null : logoOf(manifest) };
}

/**
 * 画像の読み込みが、終わっていて失敗したか（読み終わり・大きさが 0）。読み込み中（complete が
 * false）は、まだ分からないので false。
 */
export function imageBroken(img: {
	readonly complete: boolean;
	readonly naturalWidth: number;
}): boolean {
	return img.complete && img.naturalWidth === 0;
}

/** ゲームの画面のページの題名（トップは「rondo」のまま）。 */
export function pageTitle(manifest: GameManifest): string {
	return `${displayName(manifest)}｜rondo`;
}

/** 背景が明るいか（相対輝度が 0.5 を超える）。#rrggbb を受け取る。 */
function isLight(hex: string): boolean {
	const channel = (offset: number) => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	const luminance =
		0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
	return luminance > 0.5;
}
