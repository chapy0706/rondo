import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLogoSvg } from "../platform/brand/svgCheck";
import { checkLogoWebp } from "../platform/brand/webpCheck";
import { registry } from "./registry";

/** apps/web/public。 */
const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

/** WebP の画像に差し替えたゲーム。ほかは SVG のまま。 */
const WEBP_LOGOS = ["veryare", "czz", "tilt-maze", "nikaku-keshi", "minichess"];

/**
 * 登録されたロゴ（issue-69）。どのゲームも、apps/web/public/games/<識別子>/ の logo.svg か
 * logo.webp に置き、登録の logo.src に書く。登録が指すファイルは実在し、形式ごとの決まりどおり。
 *
 * - SVG: viewBox・20 KB 以下・文字なし・背景を全面に塗る・線なし（svgCheck）
 * - WebP: 512 × 512・200 KB 以下（webpCheck）
 *
 * WebP に差し替えたゲームも、戻せるように、古い SVG を残している（それも決まりどおり）。
 */
describe("登録されたロゴ（issue-69）", () => {
	it.each(registry.map((m) => [m.id, m] as const))(
		"%s: 登録の logo.src が、決まった置き場所の実在するファイルを指し、決まりどおり",
		(id, manifest) => {
			const ext = WEBP_LOGOS.includes(id) ? "webp" : "svg";
			expect(manifest.logo?.src).toBe(`/games/${id}/logo.${ext}`);
			const path = `${publicDir}${manifest.logo?.src ?? ""}`;
			expect(existsSync(path), `${path} が無い`).toBe(true);
			if (ext === "webp") {
				expect(checkLogoWebp(readFileSync(path))).toEqual([]);
			} else {
				const svg = readFileSync(path, "utf8");
				expect(checkLogoSvg(svg, manifest.logo?.background ?? "")).toEqual([]);
			}
		},
	);

	it.each(WEBP_LOGOS)(
		"%s: 戻せるように、古い SVG も残っていて、決まりどおり",
		(id) => {
			const manifest = registry.find((m) => m.id === id);
			const svg = readFileSync(`${publicDir}/games/${id}/logo.svg`, "utf8");
			expect(checkLogoSvg(svg, manifest?.logo?.background ?? "")).toEqual([]);
		},
	);
});
