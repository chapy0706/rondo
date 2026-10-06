import { describe, expect, it } from "vitest";
import { registry } from "../../games/registry";
import { entriesOf } from "./entries";

describe("entriesOf - 選択画面の入口（issue-47）", () => {
	it("リアルタイム対戦のゲーム（veryare）は、新しく遊ぶ・ルームに参加するの2つ", () => {
		const veryare = registry.find((m) => m.id === "veryare");
		if (veryare === undefined) throw new Error("veryare が未登録");
		expect(entriesOf(veryare)).toEqual([
			{ label: "新しく遊ぶ", href: "/play/veryare" },
			{ label: "ルームに参加する", href: "/lobby/veryare" },
		]);
	});

	it("ほかのゲームは入口を分けない（rolling を含む。カードを押すと従来どおり始まる）", () => {
		const others = registry.filter((m) => m.id !== "veryare");
		expect(others.map((m) => m.id)).toContain("tilt-maze");
		for (const manifest of others) {
			expect(entriesOf(manifest)).toEqual([]);
		}
	});
});
