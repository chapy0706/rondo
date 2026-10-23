/**
 * 駒とマスの見た目（文字と色）。純粋な関数と定数。
 *
 * 駒は、白も黒も、同じ「黒の塗りつぶしの駒の文字」（♚♛♜♝♞♟）で描き、白と黒は、文字の色（塗り）と
 * 縁取り（文字の周りの影 text-shadow）で表す。文字のあとに、テキスト表示を指定する異体字セレクタ
 * （U+FE0E）を付ける。
 *
 * 理由: ♟（U+265F）だけは、絵文字の一覧に入っていて、iOS（WebKit）は、異体字セレクタが無いと絵文字で
 * 描く。絵文字は文字の色（color）が効かないので、白のポーンが黒く見えていた。ほかの駒（♚♛♜♝♞）は
 * 絵文字ではないので、色が効いていた。外部の素材（画像・アイコン）は使わない。
 *
 * 色の組み合わせは、ここの定数で変えられる（茶色とクリーム色のマスの上で、白い駒も黒い駒も
 * 見分けやすいことを、pieceLook.test.ts でコントラスト比として確かめる）。
 */

import type { Color, Piece, PieceType } from "./rules";

/** マスの色（クリーム色と茶色）。 */
export const BOARD_COLORS = {
	light: "#f0d9b5",
	dark: "#b58863",
} as const;

/** 駒の色（塗りと縁取り）。 */
export const PIECE_COLORS: Readonly<
	Record<Color, { readonly fill: string; readonly outline: string }>
> = {
	w: { fill: "#ffffff", outline: "#1c1917" },
	b: { fill: "#1c1917", outline: "#fafaf9" },
};

/**
 * 駒の文字の書体。絵文字の書体を避け、記号の文字を持つ書体を先に並べる（Apple Symbols は iOS と
 * macOS にある）。
 */
export const PIECE_FONT =
	'"Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif';

/** テキスト表示を指定する異体字セレクタ。 */
const TEXT_PRESENTATION = "︎";

/** 黒の塗りつぶしの駒の文字。 */
const SYMBOLS: Readonly<Record<PieceType, string>> = {
	K: "♚",
	Q: "♛",
	R: "♜",
	B: "♝",
	N: "♞",
	P: "♟",
};

/** 縁取りの太さ（px）。 */
const OUTLINE_PX = 1.5;

export interface PieceLook {
	/** 描く文字（駒の文字 + U+FE0E）。 */
	readonly glyph: string;
	/** 文字の色。 */
	readonly fill: string;
	/** 縁取りの色。 */
	readonly outline: string;
	/** 縁取り（CSS の text-shadow の値）。 */
	readonly shadow: string;
}

/** 文字の周りの 8 方向の影で、縁取りにする。 */
function outlineShadow(color: string): string {
	const d = OUTLINE_PX;
	const offsets = [
		[-d, -d],
		[0, -d],
		[d, -d],
		[-d, 0],
		[d, 0],
		[-d, d],
		[0, d],
		[d, d],
	];
	return offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(", ");
}

export function pieceLook(piece: Pick<Piece, "type" | "color">): PieceLook {
	const colors = PIECE_COLORS[piece.color];
	return {
		glyph: `${SYMBOLS[piece.type]}${TEXT_PRESENTATION}`,
		fill: colors.fill,
		outline: colors.outline,
		shadow: outlineShadow(colors.outline),
	};
}

// --- コントラスト比（WCAG 2） ---------------------------------------------------------

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb の相対輝度。 */
function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const r = channel((n >> 16) & 0xff);
	const g = channel((n >> 8) & 0xff);
	const b = channel(n & 0xff);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 2 色（#rrggbb）のコントラスト比（1〜21）。 */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (hi + 0.05) / (lo + 0.05);
}
