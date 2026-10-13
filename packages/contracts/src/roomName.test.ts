import { describe, expect, it } from "vitest";
import cases from "./fixtures/room-names.json";
import {
	ROOM_NAME_MAX_LENGTH,
	cleanRoomName,
	defaultRoomName,
	normalizeRoomName,
} from "./roomName";

describe("ルーム名を整える（issue-58。Gleam の room/room_name と同じ見本を読む）", () => {
	it.each(cases)("$note", ({ raw, owner, expected }) => {
		expect(normalizeRoomName(raw ?? undefined, owner)).toBe(expected);
	});

	it("整えた名前は、どの見本でも 1〜20 文字（コードポイント）", () => {
		for (const { raw, owner } of cases) {
			const length = Array.from(
				normalizeRoomName(raw ?? undefined, owner),
			).length;
			expect(length).toBeGreaterThanOrEqual(1);
			expect(length).toBeLessThanOrEqual(ROOM_NAME_MAX_LENGTH);
		}
	});

	it("入力欄の検査では、空白だけの入力は空になる（送らずに既定の名前に任せる）", () => {
		expect(cleanRoomName(" 　 ")).toBe("");
	});

	it("既定の名前は、表示名に「のルーム」を付ける", () => {
		expect(defaultRoomName("user7")).toBe("user7のルーム");
	});
});
