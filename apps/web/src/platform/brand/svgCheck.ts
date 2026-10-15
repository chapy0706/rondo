/**
 * ロゴの SVG の決まり（issue-69 / docs/assets.md）を確かめる純粋な関数。登録されたロゴの検査
 * （games/logos.test.ts）が使う。
 *
 * - viewBox は 0 0 512 512。20 KB 以下
 * - 文字を入れない（text・tspan・font）。名前は画面に別に出る
 * - 最初の図形で、登録の背景の色を全面に塗る（角の丸めは画面の側の CSS）
 * - 線（stroke）を使わない。外の画像・参照・スクリプトを含まない
 * - 色は #rrggbb で書き、背景を含めて 5 色まで（平らな図形・差し色1色）
 */

/** 20 KB（バイト）。 */
export const MAX_LOGO_BYTES = 20 * 1024;

/** 背景を含めた色の数の上限。 */
const MAX_COLORS = 5;

/** 決まりに合わない点を並べる。空なら決まりどおり。 */
export function checkLogoSvg(svg: string, background: string): string[] {
	const problems: string[] = [];
	if (!/<svg[^>]*\sviewBox="0 0 512 512"/.test(svg)) {
		problems.push("viewBox が 0 0 512 512 でない");
	}
	if (new TextEncoder().encode(svg).length > MAX_LOGO_BYTES) {
		problems.push("20 KB を超えている");
	}
	if (/<text\b|<tspan\b|font-family|font-size|<font\b/i.test(svg)) {
		problems.push("文字を含む");
	}
	const first = svg.match(/<svg[^>]*>\s*(<[a-z]+\b[^>]*>)/i)?.[1] ?? "";
	const fullRect =
		/^<rect\b/.test(first) &&
		/\swidth="512"/.test(first) &&
		/\sheight="512"/.test(first) &&
		!/\sx="(?!0")/.test(first) &&
		!/\sy="(?!0")/.test(first) &&
		first.toLowerCase().includes(`fill="${background.toLowerCase()}"`);
	if (!fullRect) {
		problems.push(`背景を登録の色（${background}）で全面に塗っていない`);
	}
	if (/\sstroke(-[a-z]+)?="/i.test(svg)) {
		problems.push("線（stroke）を使っている");
	}
	if (/<image\b|<script\b|<foreignObject\b|href="(?!#)|url\((?!#)/i.test(svg)) {
		problems.push("画像・外の参照・スクリプトを含む");
	}
	const fills = [...svg.matchAll(/\sfill="([^"]*)"/gi)].map((m) =>
		(m[1] ?? "").toLowerCase(),
	);
	if (fills.some((fill) => !/^#[0-9a-f]{6}$/.test(fill) && fill !== "none")) {
		problems.push("色を #rrggbb 以外で書いている");
	}
	const colors = new Set(fills.filter((fill) => fill !== "none"));
	if (colors.size > MAX_COLORS) {
		problems.push(`色が多い（${MAX_COLORS} 色まで）`);
	}
	return problems;
}
