import { describe, expect, it } from "vitest";
import {
	ASSETS,
	bgmFor,
	mascotFor,
	pickManualUrl,
	resultCharacter,
} from "./presentation";

const beginnerOn = { mode: "beginner", bgmEnabled: true } as const;

describe("bgmFor - 画面ごとの BGM（本家の bgmRoutes と同じ選び方）", () => {
	it("起動画面とクレジットは top をループ", () => {
		expect(bgmFor("title", null, beginnerOn)).toEqual({
			src: ASSETS.bgm.top,
			loop: true,
			volume: 0.5,
		});
		expect(bgmFor("credits", null, beginnerOn)?.src).toBe(ASSETS.bgm.top);
	});

	it("出題中はお題ごとに stage2loop か stage3loop を決まった形で選ぶ", () => {
		const a = bgmFor("play", "task-a", beginnerOn);
		expect([ASSETS.bgm.stage2loop, ASSETS.bgm.stage3loop]).toContain(a?.src);
		expect(a?.loop).toBe(true);
		// 同じお題なら毎回同じ曲。
		expect(bgmFor("play", "task-a", beginnerOn)).toEqual(a);
	});

	it("出題中の曲は、お題によって両方が使われる", () => {
		const srcs = new Set(
			["t1", "t2", "t3", "t4", "t5", "t6"].map(
				(id) => bgmFor("play", id, beginnerOn)?.src,
			),
		);
		expect(srcs).toEqual(
			new Set([ASSETS.bgm.stage2loop, ASSETS.bgm.stage3loop]),
		);
	});

	it("結果画面は result を1回だけ流す", () => {
		expect(bgmFor("result", null, beginnerOn)).toEqual({
			src: ASSETS.bgm.result,
			loop: false,
			volume: 0.6,
		});
	});

	it("通常モードか BGM オフのときは鳴らさない（本家と同じく初心者モードだけ）", () => {
		expect(bgmFor("title", null, { mode: "advanced", bgmEnabled: true })).toBe(
			null,
		);
		expect(bgmFor("title", null, { mode: "beginner", bgmEnabled: false })).toBe(
			null,
		);
	});
});

describe("mascotFor - マスコットの反応", () => {
	it("採点前は一緒に考え、正解で喜び、不正解で励ます", () => {
		expect(mascotFor(null)).toBe("studying");
		expect(mascotFor(true)).toBe("success");
		expect(mascotFor(false)).toBe("encourage");
	});
});

describe("resultCharacter - 結果画面のキャラクター", () => {
	it("全問正解なら喜び、それ以外はくやしがる", () => {
		expect(resultCharacter(3, 3)).toBe(ASSETS.characters.rejoicing);
		expect(resultCharacter(2, 3)).toBe(ASSETS.characters.failing);
		expect(resultCharacter(0, 3)).toBe(ASSETS.characters.failing);
	});
});

describe("pickManualUrl - マニュアルの URL（本家と同じ検証）", () => {
	it("https の Google ドキュメントだけを通す", () => {
		expect(pickManualUrl(" https://docs.google.com/document/d/x ")).toBe(
			"https://docs.google.com/document/d/x",
		);
	});

	it("未設定・空・他のサイト・http・壊れた値は通さない", () => {
		expect(pickManualUrl(undefined)).toBeNull();
		expect(pickManualUrl("  ")).toBeNull();
		expect(pickManualUrl("https://example.com/manual")).toBeNull();
		expect(pickManualUrl("http://docs.google.com/document/d/x")).toBeNull();
		expect(pickManualUrl("not a url")).toBeNull();
	});
});

describe("ASSETS - 持ち込んだ素材は games/czz 配下に閉じる", () => {
	it("すべて /games/czz/ から始まる", () => {
		const paths = [
			...Object.values(ASSETS.bgm),
			...Object.values(ASSETS.sfx),
			...Object.values(ASSETS.characters),
		];
		for (const path of paths) expect(path.startsWith("/games/czz/")).toBe(true);
	});
});
