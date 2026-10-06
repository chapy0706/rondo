import type { RealtimeResult } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { registry, showsResultInsteadOfGame } from "../../games/registry";
import { resultView } from "./resultView";

const result: RealtimeResult = { order: "higher-is-better", rankings: [] };

describe("resultView - 結果画面の出し方（issue-42）", () => {
	it("結果が無ければ、結果画面を出さない", () => {
		for (const manifest of registry) {
			expect(resultView(manifest, null)).toBe("none");
		}
	});

	it("veryare は game-ended を受けたら、ゲームの代わりに結果画面を出す", () => {
		const veryare = registry.find((m) => m.id === "veryare");
		if (veryare === undefined) throw new Error("veryare が未登録");
		expect(resultView(veryare, result)).toBe("instead-of-game");
	});

	it("ほかのゲームの挙動は変えない（ソロは結果画面を出さず、rolling はゲームの下に並べる）", () => {
		const views = Object.fromEntries(
			registry
				.filter((m) => m.id !== "veryare")
				.map((m) => [m.id, resultView(m, result)]),
		);
		expect(views).toEqual({
			tetris: "none",
			czz: "none",
			"nikaku-keshi": "none",
			minichess: "none",
			"tilt-maze": "below-game",
		});
	});

	it("ゲームの代わりに出すのは、registry で選んだリアルタイムのゲームだけ", () => {
		const chosen = registry
			.filter((m) => showsResultInsteadOfGame(m.id))
			.map((m) => m.id);
		expect(chosen).toEqual(["veryare"]);
	});
});
