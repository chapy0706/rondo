import { describe, expect, it } from "vitest";
import { ruleBadgeOf } from "./ruleBadge";

const info = (rules: Record<string, unknown> = {}) => ({
	type: "room-info",
	explorationSeconds: 60,
	...rules,
});

describe("ruleBadgeOf - 上部バーに出す規則の名前（ルーム情報から決める / ADR 0053）", () => {
	it("動ける規則は「動ける」、増え鬼は「増え鬼」、両方は並べる", () => {
		expect(ruleBadgeOf(info({ roaming: true }))).toBe("動ける");
		expect(ruleBadgeOf(info({ spreading: true }))).toBe("増え鬼");
		expect(ruleBadgeOf(info({ roaming: true, spreading: true }))).toBe(
			"動ける・増え鬼",
		);
	});

	it("従来の規則（載っていない・false）は、何も出さない（空）", () => {
		expect(ruleBadgeOf(info())).toBe("");
		expect(ruleBadgeOf(info({ roaming: false, spreading: false }))).toBe("");
	});

	it("ルーム情報でなければ null（いまの表示を変えない）", () => {
		expect(ruleBadgeOf({ type: "phase" })).toBeNull();
		expect(ruleBadgeOf(null)).toBeNull();
		expect(ruleBadgeOf("room-info")).toBeNull();
	});
});
