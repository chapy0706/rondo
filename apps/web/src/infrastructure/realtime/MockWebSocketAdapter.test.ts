import type { ServerMessage } from "@rondo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockWebSocketAdapter } from "./MockWebSocketAdapter";

describe("MockWebSocketAdapter - ロビーからの参加（issue-40）", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("一覧から veryare のルームに参加すると、作成したときと同じく通知が流れる", () => {
		const adapter = new MockWebSocketAdapter();
		const received: ServerMessage[] = [];
		adapter.subscribe((m) => received.push(m));

		adapter.send({ type: "list-rooms", gameType: "veryare" });
		vi.advanceTimersByTime(100);
		const list = received.find((m) => m.type === "room-list");
		if (list?.type !== "room-list") throw new Error("一覧が届かない");
		const roomId = list.rooms[0]?.roomId;
		if (roomId === undefined) throw new Error("ルームがない");

		adapter.send({ type: "join-room", gameType: "veryare", roomId });
		vi.advanceTimersByTime(1000);
		const joined = received.find((m) => m.type === "room-joined");
		expect(joined).toMatchObject({ roomId, gameType: "veryare" });
		expect(
			received.some((m) => m.type === "game-state" && m.roomId === roomId),
		).toBe(true);
		adapter.close();
	});

	it("veryare 以外は、一覧のルームに加わるだけ（通知は流さない）", () => {
		const adapter = new MockWebSocketAdapter();
		const received: ServerMessage[] = [];
		adapter.subscribe((m) => received.push(m));
		adapter.send({ type: "list-rooms", gameType: "tilt-maze" });
		vi.advanceTimersByTime(100);
		const list = received.find((m) => m.type === "room-list");
		if (list?.type !== "room-list") throw new Error("一覧が届かない");
		const roomId = list.rooms[0]?.roomId as string;
		adapter.send({ type: "join-room", gameType: "tilt-maze", roomId });
		vi.advanceTimersByTime(1000);
		const joined = received.find((m) => m.type === "room-joined");
		expect(joined?.type === "room-joined" && joined.players).toHaveLength(2);
		expect(received.some((m) => m.type === "game-state")).toBe(false);
	});
});
