import { describe, expect, it } from "vitest";
import { findGameLoader, findManifest, registry } from "../registry";
import { czzManifest } from "./manifest";

describe("czz の registry 登録（ADR 0003）", () => {
	it("選択画面が読む registry にソロゲームとして載っている", () => {
		expect(registry).toContain(czzManifest);
		expect(findManifest("czz")).toMatchObject({
			kind: "solo",
			minPlayers: 1,
			maxPlayers: 1,
		});
	});

	it("ゲームホストが本体を読み込める", async () => {
		const loader = findGameLoader("czz");
		expect(loader).toBeDefined();
		const mod = await loader?.();
		expect(typeof mod?.default).toBe("function");
	});
});
