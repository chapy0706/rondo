import { describe, expect, it } from "vitest";
import { isFullscreenGame, registry } from "./registry";

describe("isFullscreenGame - 画面いっぱいの 1 枚にするゲーム", () => {
	it("すごくアレ（veryare）と、ひとり用の盤のゲーム（tetris・nikaku-keshi・minichess）。ほかのゲームは、これまでの形のまま", () => {
		const fullscreen = ["veryare", "tetris", "nikaku-keshi", "minichess"];
		for (const id of fullscreen) expect(isFullscreenGame(id)).toBe(true);
		for (const manifest of registry) {
			if (fullscreen.includes(manifest.id)) continue;
			expect(isFullscreenGame(manifest.id)).toBe(false);
		}
		expect(isFullscreenGame("unknown")).toBe(false);
	});
});
