import type { GameManifest } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameCard } from "./GameCard";

const manifest: GameManifest = {
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

const render = (m: GameManifest) =>
	renderToStaticMarkup(
		<GameCard
			manifest={m}
			selected={false}
			onClick={() => undefined}
			onFocus={() => undefined}
		/>,
	);

describe("GameCard - 選択画面のカード（issue-69）", () => {
	it("識別子の属性（data-game）を持ち、読み上げは spokenTitle（落ちものパズル）", () => {
		const html = render(manifest);
		expect(html).toContain('data-game="tetris"');
		expect(html).toContain('aria-label="落ちものパズル"');
		expect(html).toContain('href="/play/tetris"');
	});

	it("表示名を変えても、識別子の属性と行き先は変わらない（テストと E2E は、これで探す）", () => {
		const html = render({
			...manifest,
			title: "別の名前",
			spokenTitle: "別の名前",
		});
		expect(html).toContain('data-game="tetris"');
		expect(html).toContain('href="/play/tetris"');
		expect(html).not.toContain("テ〇〇ス");
	});

	it("ロゴの画像が無ければ、仮のタイル（壊れた画像を出さない）", () => {
		const html = render(manifest);
		expect(html).toContain('data-logo="tile"');
		expect(html).not.toContain("<img");
	});
});
