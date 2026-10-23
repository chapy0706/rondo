import { describe, expect, it } from "vitest";
import {
	BOARD_COLORS,
	PIECE_COLORS,
	contrastRatio,
	pieceLook,
} from "./pieceLook";
import type { Color, PieceType } from "./rules";

const TYPES: readonly PieceType[] = ["K", "Q", "R", "B", "N", "P"];
const SIDES: readonly Color[] = ["w", "b"];
/** 黒の塗りつぶしの駒の文字（U+265A〜U+265F）。 */
const FILLED = ["♚", "♛", "♜", "♝", "♞", "♟"];
/** テキスト表示を指定する異体字セレクタ（絵文字で描かせない）。 */
const TEXT_STYLE = "︎";

describe("pieceLook - 駒の見た目（文字と色）", () => {
	it("白と黒で、同じ文字を使い、色が違う（すべての駒の種類で）", () => {
		for (const type of TYPES) {
			const white = pieceLook({ type, color: "w" });
			const black = pieceLook({ type, color: "b" });
			expect(white.glyph).toBe(black.glyph);
			expect(white.fill).not.toBe(black.fill);
			expect(white.outline).not.toBe(black.outline);
		}
	});

	it("文字は、黒の塗りつぶしの駒に、テキスト表示の異体字セレクタ（U+FE0E）を付けたもの", () => {
		const bases = TYPES.map((type) => {
			const { glyph } = pieceLook({ type, color: "w" });
			expect(glyph.endsWith(TEXT_STYLE)).toBe(true);
			expect([...glyph]).toHaveLength(2);
			return glyph.slice(0, -1);
		});
		expect(new Set(bases)).toEqual(new Set(FILLED));
	});

	it("縁取りは、文字の周りの影（text-shadow）で描く。色は縁取りの色", () => {
		for (const side of SIDES) {
			const look = pieceLook({ type: "P", color: side });
			expect(look.shadow).toContain(look.outline);
		}
	});

	it("茶色とクリーム色のマスの上で、白い駒も黒い駒も、見分けやすい", () => {
		// 塗りか縁取りの、どちらかが、マスと 3:1 以上（WCAG の文字以外の図形の基準）。
		// 塗りと縁取りどうしは 4.5:1 以上（駒の形が読める）。
		for (const side of SIDES) {
			const piece = PIECE_COLORS[side];
			expect(contrastRatio(piece.fill, piece.outline)).toBeGreaterThanOrEqual(
				4.5,
			);
			for (const square of [BOARD_COLORS.light, BOARD_COLORS.dark]) {
				const best = Math.max(
					contrastRatio(piece.fill, square),
					contrastRatio(piece.outline, square),
				);
				expect(best).toBeGreaterThanOrEqual(3);
			}
		}
	});
});

describe("contrastRatio - 2 色のコントラスト比（WCAG）", () => {
	it("白と黒は 21、同じ色は 1、順番によらない", () => {
		expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
		expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
	});
});
