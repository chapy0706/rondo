import { describe, expect, it } from "vitest";
import {
	UNNAMED_ROOM_LABEL,
	numberedRoomLabels,
	roomListLabel,
	roomNameHint,
} from "./roomName";

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

describe("同じ名前のルームの番号（一覧の表示だけ）", () => {
	const named = (roomId: string, name?: string) =>
		name === undefined ? { ...room, roomId } : { ...room, roomId, name };

	it("同じ名前が 2 つ以上あれば、一覧の順で、無印・(2)・(3) を付ける", () => {
		expect(
			numberedRoomLabels([
				named("r1", "user1のルーム"),
				named("r2", "たのしい部屋"),
				named("r3", "user1のルーム"),
				named("r4", "user1のルーム"),
			]),
		).toEqual([
			"user1のルーム",
			"たのしい部屋",
			"user1のルーム(2)",
			"user1のルーム(3)",
		]);
	});

	it("重ならなければ、名前のまま。名前のないルームも、同じ規則で数える", () => {
		expect(numberedRoomLabels([named("r1", "a"), named("r2", "b")])).toEqual([
			"a",
			"b",
		]);
		expect(numberedRoomLabels([named("r1"), named("r2")])).toEqual([
			UNNAMED_ROOM_LABEL,
			`${UNNAMED_ROOM_LABEL}(2)`,
		]);
		expect(numberedRoomLabels([])).toEqual([]);
	});

	it("番号を付けても、識別子は出さない", () => {
		const labels = numberedRoomLabels([named("r1", "x"), named("r2", "x")]);
		for (const label of labels) expect(label).not.toContain("r2");
	});
});
