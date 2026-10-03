import { describe, expect, it } from "vitest";
import { MODES, chooseMode } from "./modes";
import { TEXT } from "./text";

describe("モードの定義（issue-36）", () => {
	it("1人モードと対戦モードがある", () => {
		expect(MODES.map((mode) => mode.id)).toEqual(["solo", "versus"]);
	});

	it("1人モードは利用でき、選ぶと遊び始める", () => {
		expect(chooseMode("solo")).toEqual({ kind: "play" });
	});

	it("対戦モードは準備中で、選ぶと準備中のお知らせを出す（通信も遷移もしない）", () => {
		const versus = MODES.find((mode) => mode.id === "versus");
		expect(versus?.available).toBe(false);
		expect(chooseMode("versus")).toEqual({
			kind: "notice",
			message: TEXT.versusUnavailable,
		});
	});
});

describe("表示文字列", () => {
	it("名前は英小文字の rolling", () => {
		expect(TEXT.name).toBe("rolling");
	});

	it("旧名称（Tilt Maze）がどこにも残っていない", () => {
		expect(JSON.stringify(TEXT)).not.toMatch(/tilt/i);
		expect(JSON.stringify(MODES)).not.toMatch(/tilt/i);
	});
});
