import { describe, expect, it } from "vitest";
import manifest from "../../app/manifest";
import {
	PWA_ICON_SIZES,
	RONDO_ICON_COLORS,
	isPwaIconSize,
	ringGeometry,
} from "./rondoIcon";

describe("rondo のホーム画面のアイコン（issue-69）", () => {
	it("輪は RondoMark（40 の枠に半径 14・太さ 7）を、アイコンの 60% の枠で中央に置いた大きさ", () => {
		// 40 の枠 → 512 × 0.6 = 307.2。外の直径は (14 + 3.5) × 2 = 35 → 268.8、太さ 7 → 53.76。
		expect(ringGeometry(512)).toEqual({ diameter: 269, border: 54 });
		expect(ringGeometry(180)).toEqual({ diameter: 95, border: 19 });
	});

	it("色は ink の背景と、アクセントの黄の輪（globals.css と同じ）", () => {
		expect(RONDO_ICON_COLORS).toEqual({
			background: "#13111f",
			ring: "#f5b841",
		});
	});

	it("ホーム画面のアイコンの大きさは 192 と 512 だけ", () => {
		expect(PWA_ICON_SIZES).toEqual([192, 512]);
		expect(isPwaIconSize("192")).toBe(true);
		expect(isPwaIconSize("512")).toBe(true);
		expect(isPwaIconSize("180")).toBe(false);
		expect(isPwaIconSize("abc")).toBe(false);
	});
});

describe("app/manifest.ts（Web App Manifest）", () => {
	it("名前は rondo、表示は browser（standalone にしない）、色は ink", () => {
		const m = manifest();
		expect(m.name).toBe("rondo");
		expect(m.short_name).toBe("rondo");
		expect(m.display).toBe("browser");
		expect(m.theme_color).toBe("#13111f");
	});

	it("192 と 512 の PNG のアイコンを載せる", () => {
		const icons = manifest().icons ?? [];
		expect(
			icons
				.filter((icon) => icon.type === "image/png")
				.map((icon) => icon.sizes),
		).toEqual(["192x192", "512x512"]);
	});
});
