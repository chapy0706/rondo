import type { GameManifest } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_TILE_BACKGROUND,
	displayName,
	logoOf,
	logoView,
	pageTitle,
	spokenName,
	tileOf,
} from "./gameBrand";

const base: GameManifest = {
	id: "sample",
	title: "すごくアレ",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 5,
	description: "隠れて、ばれずに、逃げ切ろう",
	launchScreen: "custom",
};

describe("displayName - 画面に出す名前（issue-69）", () => {
	it("登録の title を、前後の空白を落として返す", () => {
		expect(displayName({ ...base, title: "  ころころ迷路 " })).toBe(
			"ころころ迷路",
		);
	});

	it("title が空なら、識別子を出す（空の名前を出さない）", () => {
		expect(displayName({ ...base, title: "   " })).toBe("sample");
	});
});

describe("spokenName - 読み上げと代替の文字（aria-label・alt）", () => {
	it("spokenTitle があれば、それを使う（テ〇〇ス → 落ちものパズル）", () => {
		expect(
			spokenName({ ...base, title: "テ〇〇ス", spokenTitle: "落ちものパズル" }),
		).toBe("落ちものパズル");
	});

	it("無ければ、画面に出す名前", () => {
		expect(spokenName(base)).toBe("すごくアレ");
	});
});

describe("logoOf - ロゴの画像", () => {
	it("logo.src があれば、そのパスと、代替の文字（読み上げの名前）", () => {
		expect(
			logoOf({
				...base,
				logo: { src: "/games/sample/logo.svg", background: "#26315c" },
			}),
		).toEqual({ src: "/games/sample/logo.svg", alt: "すごくアレ" });
	});

	it("logo が無い・src が無い・空なら null（仮のタイルを出す）", () => {
		expect(logoOf(base)).toBeNull();
		expect(logoOf({ ...base, logo: { background: "#26315c" } })).toBeNull();
		expect(
			logoOf({ ...base, logo: { src: " ", background: "#26315c" } }),
		).toBeNull();
	});
});

describe("tileOf - ロゴが無いときの仮のタイル", () => {
	it("背景はゲームの色、文字は画面に出す名前の頭文字（全角でも、サロゲートペアでも1文字）", () => {
		expect(tileOf({ ...base, logo: { background: "#26315c" } })).toMatchObject({
			background: "#26315c",
			initial: "す",
		});
		expect(tileOf({ ...base, title: "テ〇〇ス" }).initial).toBe("テ");
		expect(tileOf({ ...base, title: "𠮷野ゲーム" }).initial).toBe("𠮷");
		expect(tileOf({ ...base, title: "chess" }).initial).toBe("C");
	});

	it("背景の色が無ければ、既定の色", () => {
		expect(tileOf(base).background).toBe(DEFAULT_TILE_BACKGROUND);
	});

	it("文字の色は、暗い背景なら白、明るい背景なら濃い色（読めるように）", () => {
		expect(
			tileOf({ ...base, logo: { background: "#26315c" } }).foreground,
		).toBe("#ffffff");
		expect(
			tileOf({ ...base, logo: { background: "#ffe3dc" } }).foreground,
		).toBe("#13111f");
	});

	it("色の書き方が正しくなければ、既定の背景にする（#rrggbb だけ受け付ける）", () => {
		for (const background of ["red", "#fff", "#12345g", ""]) {
			expect(tileOf({ ...base, logo: { background } }).background).toBe(
				DEFAULT_TILE_BACKGROUND,
			);
		}
	});
});

describe("pageTitle - ゲームの画面のページの題名", () => {
	it("「名前｜rondo」の形", () => {
		expect(pageTitle(base)).toBe("すごくアレ｜rondo");
	});
});

describe("logoView - 画面に出すもの（タイルと、重ねる画像）", () => {
	const withLogo: GameManifest = {
		...base,
		logo: { src: "/games/sample/logo.svg", background: "#26315c" },
	};

	it("画像があれば、タイルの上に画像を重ねる", () => {
		const view = logoView(withLogo, false);
		expect(view.tile.initial).toBe("す");
		expect(view.image).toEqual({
			src: "/games/sample/logo.svg",
			alt: "すごくアレ",
		});
	});

	it("画像が読めなかったら、画像を隠して、タイルだけにする（壊れた画像を出さない）", () => {
		expect(logoView(withLogo, true).image).toBeNull();
		expect(logoView(withLogo, true).tile.background).toBe("#26315c");
	});

	it("画像が無ければ、タイルだけ", () => {
		expect(logoView(base, false).image).toBeNull();
	});
});
