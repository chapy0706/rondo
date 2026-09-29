import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	type GamePayload,
	dispatchGameState,
	isGamePayload,
	readGameState,
	toGameEvent,
} from "./protocol";

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

	it("reads game-state-to payload the same way as game-state", () => {
		const message: ServerMessage = {
			type: "game-state-to",
			gameType: "chameleon",
			roomId: "room-1",
			to: "p1",
			payload: { type: "positions", seen: [] },
		};
		expect(readGameState(message, "chameleon", "room-1")).toEqual({
			type: "positions",
			seen: [],
		});
	});

	it("ignores game-state-to for other games or rooms, and malformed payloads", () => {
		const base = {
			type: "game-state-to" as const,
			gameType: "chameleon",
			roomId: "room-1",
			to: "p1",
			payload: { type: "positions" },
		};
		expect(
			readGameState({ ...base, roomId: "room-2" }, "chameleon", "room-1"),
		).toBeNull();
		expect(
			readGameState({ ...base, gameType: "tilt-maze" }, "chameleon", "room-1"),
		).toBeNull();
		expect(
			readGameState({ ...base, payload: { noType: 1 } }, "chameleon", "room-1"),
		).toBeNull();
	});
});

describe("dispatchGameState - useRealtimeGame の on への振り分け", () => {
	function handlersFor(type: string) {
		const received: GamePayload[] = [];
		const handlers = new Map<string, Set<(payload: GamePayload) => void>>([
			[type, new Set([(payload: GamePayload) => received.push(payload)])],
		]);
		return { handlers, received };
	}

	it("ブロードキャストも限定配信も、同じ on のハンドラに届く", () => {
		const { handlers, received } = handlersFor("positions");
		dispatchGameState(
			{
				type: "game-state",
				gameType: "chameleon",
				roomId: "room-1",
				payload: { type: "positions", from: "all" },
			},
			"chameleon",
			"room-1",
			handlers,
		);
		dispatchGameState(
			{
				type: "game-state-to",
				gameType: "chameleon",
				roomId: "room-1",
				to: "p1",
				payload: { type: "positions", from: "only-you" },
			},
			"chameleon",
			"room-1",
			handlers,
		);
		expect(received).toEqual([
			{ type: "positions", from: "all" },
			{ type: "positions", from: "only-you" },
		]);
	});

	it("購読していない type や、別ルーム宛ては届けない", () => {
		const { handlers, received } = handlersFor("positions");
		dispatchGameState(
			{
				type: "game-state-to",
				gameType: "chameleon",
				roomId: "room-1",
				to: "p1",
				payload: { type: "other" },
			},
			"chameleon",
			"room-1",
			handlers,
		);
		dispatchGameState(
			{
				type: "game-state-to",
				gameType: "chameleon",
				roomId: "room-2",
				to: "p1",
				payload: { type: "positions" },
			},
			"chameleon",
			"room-1",
			handlers,
		);
		expect(received).toEqual([]);
	});
});
