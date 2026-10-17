import { describe, expect, it } from "vitest";
import { availabilityLabel, roomAvailability } from "./roomAvailability";

const room = (
	playerCount: number,
	status: "waiting" | "playing" = "waiting",
	capacity = 5,
) => ({
	roomId: "room-1",
	gameType: "veryare",
	playerCount,
	capacity,
	status,
});

describe("roomAvailability - 一覧のルームの状態（issue-60。いまの RoomSummary の項目だけで決める）", () => {
	it("待機中で空きがあれば、参加できる", () => {
		expect(roomAvailability(room(2))).toBe("open");
		expect(roomAvailability(room(4))).toBe("open");
	});

	it("人数が定員に達していれば、満員（CPU も人数に数える）", () => {
		expect(roomAvailability(room(5))).toBe("full");
		expect(roomAvailability(room(6))).toBe("full");
	});

	it("ゲームが始まっていれば（鬼選出が済んだあと）、満員でも、プレイ中を優先する", () => {
		expect(roomAvailability(room(2, "playing"))).toBe("playing");
		expect(roomAvailability(room(5, "playing"))).toBe("playing");
	});
});

describe("availabilityLabel - 一覧に出す状態の文言", () => {
	it("待機中・満員・プレイ中", () => {
		expect(availabilityLabel("open")).toBe("待機中");
		expect(availabilityLabel("full")).toBe("満員");
		expect(availabilityLabel("playing")).toBe("プレイ中");
	});
});
