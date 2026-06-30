import { describe, expect, it } from "vitest";
import type { RealtimeGame, SoloGame } from "./game";
import type { GameManifest } from "./manifest";
import type { ClientMessage, ServerMessage } from "./messages";

describe("contracts", () => {
	it("solo manifest declares kind solo with single player", () => {
		const manifest: GameManifest = {
			id: "tetris",
			title: "Tetris",
			kind: "solo",
			minPlayers: 1,
			maxPlayers: 1,
			thumbnail: "/games/tetris.png",
			description: "一人で黙々と遊ぶ",
		};
		expect(manifest.kind).toBe("solo");
		expect(manifest.minPlayers).toBe(1);
	});

	it("join-room message carries multiplexing keys", () => {
		const message: ClientMessage = {
			type: "join-room",
			gameType: "tilt-maze",
			roomId: "room-1",
		};
		expect(message.gameType).toBe("tilt-maze");
		expect(message.roomId).toBe("room-1");
	});

	it("game-ended carries a realtime result", () => {
		const message: ServerMessage = {
			type: "game-ended",
			gameType: "tilt-maze",
			roomId: "room-1",
			result: { order: "lower-is-better", rankings: [] },
		};
		expect(message.type).toBe("game-ended");
		expect(message.result.rankings).toHaveLength(0);
	});

	it("SoloGame has no realtime port while RealtimeGame connects", () => {
		const manifest: GameManifest = {
			id: "tilt-maze",
			title: "Tilt Maze",
			kind: "realtime",
			minPlayers: 2,
			maxPlayers: 4,
			thumbnail: "/games/tilt-maze.png",
			description: "傾けて転がす",
		};
		const solo: SoloGame = {
			kind: "solo",
			manifest: {
				...manifest,
				id: "tetris",
				kind: "solo",
				minPlayers: 1,
				maxPlayers: 1,
			},
		};
		const realtime: RealtimeGame = {
			kind: "realtime",
			manifest,
			connect: () => {},
		};
		expect("connect" in solo).toBe(false);
		expect(typeof realtime.connect).toBe("function");
	});
});
