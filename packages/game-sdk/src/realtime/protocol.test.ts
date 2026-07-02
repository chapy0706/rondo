import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { isGamePayload, readGameState, toGameEvent } from "./protocol";

describe("realtime protocol", () => {
	it("wraps a payload with multiplexing keys", () => {
		expect(toGameEvent("tilt-maze", "room-1", { type: "goal" })).toEqual({
			type: "game-event",
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { type: "goal" },
		});
	});

	it("validates the minimal payload shape", () => {
		expect(isGamePayload({ type: "goal" })).toBe(true);
		expect(isGamePayload({ type: 1 })).toBe(false);
		expect(isGamePayload(null)).toBe(false);
		expect(isGamePayload("goal")).toBe(false);
	});

	it("reads game-state payload addressed to this game and room", () => {
		const message: ServerMessage = {
			type: "game-state",
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { type: "rank", place: 1 },
		};
		expect(readGameState(message, "tilt-maze", "room-1")).toEqual({
			type: "rank",
			place: 1,
		});
	});

	it("ignores messages for other games, rooms, or types", () => {
		const base = {
			type: "game-state" as const,
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { type: "rank" },
		};
		expect(
			readGameState({ ...base, roomId: "room-2" }, "tilt-maze", "room-1"),
		).toBeNull();
		expect(
			readGameState({ ...base, gameType: "tetris" }, "tilt-maze", "room-1"),
		).toBeNull();
		expect(
			readGameState(
				{ type: "player-left", roomId: "room-1", playerId: "p1" },
				"tilt-maze",
				"room-1",
			),
		).toBeNull();
	});

	it("rejects malformed payloads", () => {
		const message: ServerMessage = {
			type: "game-state",
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { noType: true },
		};
		expect(readGameState(message, "tilt-maze", "room-1")).toBeNull();
	});
});
