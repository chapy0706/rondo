import { describe, expect, it } from "vitest";
import { UNNAMED_ROOM_LABEL, roomListLabel, roomNameHint } from "./roomName";

const room = {
	roomId: "room-0123456789abcdef",
	gameType: "veryare",
	playerCount: 1,
	capacity: 5,
	status: "waiting",
} as const;

describe("ロビーのルーム名（issue-58）", () => {
	it("一覧には名前を出し、識別子は出さない", () => {
		expect(roomListLabel({ ...room, name: "たのしい部屋" })).toBe(
			"たのしい部屋",
		);
		expect(roomListLabel(room)).toBe(UNNAMED_ROOM_LABEL);
		expect(roomListLabel(room)).not.toContain(room.roomId);
	});

	it("空欄と、20 文字以内の名前には、追加の案内を出さない", () => {
		expect(roomNameHint("")).toBeNull();
		expect(roomNameHint("あ".repeat(20))).toBeNull();
	});

	it("21 文字以上は、切り捨てると案内する", () => {
		expect(roomNameHint("あ".repeat(21))).toContain("切り捨て");
	});

	it("空白だけは、既定の名前になると案内する", () => {
		expect(roomNameHint(" 　 ")).toContain("既定の名前");
	});
});
