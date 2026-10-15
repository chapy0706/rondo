import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLogoSvg } from "../platform/brand/svgCheck";
import { registry } from "./registry";

/** apps/web/public。 */
const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

/**
 * 登録されたロゴ（issue-69）。どのゲームも、apps/web/public/games/<識別子>/logo.svg に置き、
 * 登録の logo.src に書く。SVG は決まり（viewBox・20 KB 以下・文字なし・背景を全面に塗る・線なし）
 * どおり。
 */
describe("登録されたロゴ（issue-69）", () => {
	it.each(registry.map((m) => [m.id, m] as const))(
		"%s: 決まった置き場所の SVG で、決まりどおり",
		(id, manifest) => {
			expect(manifest.logo?.src).toBe(`/games/${id}/logo.svg`);
			const svg = readFileSync(`${publicDir}/games/${id}/logo.svg`, "utf8");
			expect(checkLogoSvg(svg, manifest.logo?.background ?? "")).toEqual([]);
		},
	);
});
