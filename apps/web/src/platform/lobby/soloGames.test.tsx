import type { GameManifest } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { registry } from "../../games/registry";
import { SoloGameLinks, soloGames } from "./soloGames";

describe("soloGames - ルームを作れないときの、ひとり用のゲーム（issue-60）", () => {
	it("登録の中の、ひとり用（kind: solo）だけを、登録の順に返す", () => {
		const games = soloGames(registry);
		expect(games.length).toBeGreaterThan(0);
		expect(games.every((m) => m.kind === "solo")).toBe(true);
		expect(games.map((m) => m.id)).toEqual(
			registry.filter((m) => m.kind === "solo").map((m) => m.id),
		);
		expect(games.map((m) => m.id)).not.toContain("veryare");
	});

	it("一覧は、ゲームの画面への入口と、日本語名を出す", () => {
		const games: GameManifest[] = soloGames(registry).slice(0, 2);
		const html = renderToStaticMarkup(<SoloGameLinks games={games} />);
		for (const game of games) {
			expect(html).toContain(`href="/play/${game.id}"`);
			expect(html).toContain(game.title);
		}
		expect(html).toContain('data-testid="lobby-solo-games"');
		expect(html).toContain('href="/select"');
	});
});
