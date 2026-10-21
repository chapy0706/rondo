/**
 * ロゴの WebP の決まり（docs/assets.md）を確かめる純粋な関数。登録されたロゴの検査
 * （games/logos.test.ts）が使う。画像を描かずに、ファイルの頭（RIFF のヘッダー）だけを読む。
 *
 * - 幅と高さは 512 × 512
 * - 200 KB 以下
 *
 * 読めるのは、非可逆（VP8）・可逆（VP8L）・拡張（VP8X）の 3 つの形。
 */

/** 200 KB（バイト）。 */
export const MAX_LOGO_WEBP_BYTES = 200 * 1024;

/** ロゴの一辺（px）。 */
const LOGO_SIZE = 512;

/** WebP の幅と高さ。WebP として読めなければ null。 */
export function webpSize(
	bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
	if (bytes.length < 16) return null;
	if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
		return null;
	}
	const at = (i: number) => bytes[i] ?? 0;
	switch (ascii(bytes, 12, 4)) {
		case "VP8 ": {
			// 3 バイトの枠の頭、開始の印（9d 01 2a）、幅と高さ（下の 14 ビット。上の 2 ビットは拡大の印）。
			if (bytes.length < 30) return null;
			if (at(23) !== 0x9d || at(24) !== 0x01 || at(25) !== 0x2a) return null;
			return {
				width: (at(26) | (at(27) << 8)) & 0x3fff,
				height: (at(28) | (at(29) << 8)) & 0x3fff,
			};
		}
		case "VP8L": {
			// 印（0x2f）のあと、幅 - 1 と高さ - 1 を 14 ビットずつ。
			if (bytes.length < 25 || at(20) !== 0x2f) return null;
			const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
			return {
				width: (bits & 0x3fff) + 1,
				height: ((bits >>> 14) & 0x3fff) + 1,
			};
		}
		case "VP8X": {
			// 4 バイトの印のあと、キャンバスの幅 - 1 と高さ - 1 を 24 ビットずつ。
			if (bytes.length < 30) return null;
			return {
				width: (at(24) | (at(25) << 8) | (at(26) << 16)) + 1,
				height: (at(27) | (at(28) << 8) | (at(29) << 16)) + 1,
			};
		}
		default:
			return null;
	}
}

/** 決まりに合わない点を並べる。空なら決まりどおり。 */
export function checkLogoWebp(bytes: Uint8Array): string[] {
	const size = webpSize(bytes);
	if (size === null) return ["WebP として読めない"];
	const problems: string[] = [];
	if (size.width !== LOGO_SIZE || size.height !== LOGO_SIZE) {
		problems.push(
			`幅と高さが ${LOGO_SIZE} × ${LOGO_SIZE} でない（${size.width} × ${size.height}）`,
		);
	}
	if (bytes.length > MAX_LOGO_WEBP_BYTES) {
		problems.push("200 KB を超えている");
	}
	return problems;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}
