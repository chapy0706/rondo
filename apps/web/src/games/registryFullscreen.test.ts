import { describe, expect, it } from "vitest";
import { isFullscreenGame, registry } from "./registry";

describe("isFullscreenGame - 画面いっぱいの 1 枚にするゲーム", () => {
	it("すごくアレ（veryare）だけ。ほかのゲームは、これまでの形のまま", () => {
		expect(isFullscreenGame("veryare")).toBe(true);
		for (const manifest of registry) {
			if (manifest.id === "veryare") continue;
			expect(isFullscreenGame(manifest.id)).toBe(false);
		}
		expect(isFullscreenGame("unknown")).toBe(false);
	});
});
