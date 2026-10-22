import { describe, expect, it } from "vitest";
import { bgmFor, preloadKeysFor } from "./bgm";

describe("場面と BGM の対応（issue-63）", () => {
	it("開始画面・選択画面・ロビー・設定は top", () => {
		for (const path of ["/", "/select", "/lobby/veryare", "/settings"]) {
			expect(bgmFor({ path, game: undefined, result: false })).toBe("bgm-top");
		}
	});

	it("veryare の画面: ゲームが知らせた BGM。知らせる前（起動画面・接続中）は top", () => {
		const path = "/play/veryare";
		expect(bgmFor({ path, game: undefined, result: false })).toBe("bgm-top");
		expect(bgmFor({ path, game: "bgm-top", result: false })).toBe("bgm-top");
		expect(bgmFor({ path, game: "bgm-game", result: false })).toBe("bgm-game");
		expect(bgmFor({ path, game: null, result: false })).toBeNull();
	});

	it("結果画面は無音（ゲームの知らせより優先）", () => {
		expect(
			bgmFor({ path: "/play/veryare", game: "bgm-game", result: true }),
		).toBeNull();
		expect(
			bgmFor({ path: "/play/veryare", game: undefined, result: true }),
		).toBeNull();
	});

	it("veryare 以外のゲームの画面と、知らない画面は無音", () => {
		expect(
			bgmFor({ path: "/play/tetris", game: undefined, result: false }),
		).toBeNull();
		expect(
			bgmFor({ path: "/play/tetris", game: "bgm-game", result: false }),
		).toBeNull();
		expect(bgmFor({ path: "/other", game: undefined, result: false })).toBe(
			null,
		);
	});

	it("末尾の / は、無いものとして読む", () => {
		expect(bgmFor({ path: "/select/", game: undefined, result: false })).toBe(
			"bgm-top",
		);
		expect(
			bgmFor({ path: "/play/veryare/", game: "bgm-game", result: false }),
		).toBe("bgm-game");
	});
});

describe("先に読む素材の順番（issue-63）", () => {
	it("どの画面でも、top と、カウントと開始の音を先に読む", () => {
		expect(preloadKeysFor("/select")).toEqual([
			"bgm-top",
			"se-count",
			"se-start",
		]);
	});

	it("veryare の画面では、続けて当たり・外れ・塗る音、最後に game を読む", () => {
		expect(preloadKeysFor("/play/veryare")).toEqual([
			"bgm-top",
			"se-count",
			"se-start",
			"se-hit",
			"se-miss",
			"se-paint",
			"bgm-game",
		]);
	});
});
