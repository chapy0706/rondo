import { describe, expect, it } from "vitest";
import { roomBadge, setRoomBadge } from "./roomBadge";

describe("roomBadge - 上部バーに出す、ルームの規則の名前の置き場（ADR 0053）", () => {
	it("ゲームが渡した名前を、ルームごとに返す。渡されていなければ空", () => {
		setRoomBadge("room-a", "動ける");
		setRoomBadge("room-b", "");
		expect(roomBadge("room-a")).toBe("動ける");
		expect(roomBadge("room-b")).toBe("");
		expect(roomBadge("room-x")).toBe("");
		expect(roomBadge(null)).toBe("");
	});
});
