import type { GameManifest } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameLogo } from "./GameLogo";

const base: GameManifest = {
	id: "tetris",
	title: "テ〇〇ス",
	spokenTitle: "落ちものパズル",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	description: "落ちてくるブロックを、そろえて消そう",
	launchScreen: "shared",
	logo: { background: "#5b3f8f" },
};

describe("GameLogo - ロゴと仮のタイル（issue-69）", () => {
	it("画像が無ければ、背景の色と頭文字の仮のタイルだけ（img を出さない）", () => {
		const html = renderToStaticMarkup(<GameLogo manifest={base} size={160} />);
		expect(html).toContain('data-logo="tile"');
		expect(html).toContain('data-game="tetris"');
		expect(html).toContain("background-color:#5b3f8f");
		expect(html).toContain("テ");
		expect(html).not.toContain("<img");
	});

	it("画像があれば、遅延読み込み・大きさ指定・代替の文字（読み上げの名前）の img を、タイルの上に重ねる", () => {
		const html = renderToStaticMarkup(
			<GameLogo
				manifest={{
					...base,
					logo: { src: "/games/tetris/logo.svg", background: "#5b3f8f" },
				}}
				size={96}
			/>,
		);
		expect(html).toContain('data-logo="image"');
		expect(html).toMatch(/<img[^>]*loading="lazy"/);
		expect(html).toMatch(/<img[^>]*width="96"[^>]*height="96"/);
		expect(html).toMatch(/<img[^>]*alt="落ちものパズル"/);
		// 画像の下にも、タイル（頭文字）を敷いている。
		expect(html).toContain("テ");
	});

	it("WebP の画像でも、SVG と同じく、遅延読み込み・大きさ指定・代替の文字の img を、タイルの上に重ねる", () => {
		const html = renderToStaticMarkup(
			<GameLogo
				manifest={{
					...base,
					logo: { src: "/games/tetris/logo.webp", background: "#5b3f8f" },
				}}
				size={48}
			/>,
		);
		expect(html).toContain('data-logo="image"');
		expect(html).toMatch(/<img[^>]*src="\/games\/tetris\/logo\.webp"/);
		expect(html).toMatch(/<img[^>]*loading="lazy"/);
		expect(html).toMatch(/<img[^>]*width="48"[^>]*height="48"/);
		expect(html).toMatch(/<img[^>]*alt="落ちものパズル"/);
		expect(html).toContain("background-color:#5b3f8f");
		expect(html).toContain("テ");
	});
});
