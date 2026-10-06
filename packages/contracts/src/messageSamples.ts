/**
 * 全メッセージ種別の見本（issue-31 / ADR 0009）。
 *
 * TS の型で書いた見本を、fixtures/messages.json と一致させる（messageSamples.test.ts）。
 * Gleam 側は同じ JSON を読み、decode → encode して元と一致することを確かめる
 * （server/test/rondo_server/protocol/json_test.gleam）。これで TS の型・JSON・
 * Gleam の型の三者がずれないようにする。
 */

import type { ClientMessage, ServerMessage } from "./messages";

export const clientMessageSamples = [
	{ type: "set-name", playerId: "p-1", name: "user1" },
	{ type: "list-rooms", gameType: "veryare" },
	{ type: "create-room", gameType: "tilt-maze" },
	{
		type: "create-room",
		gameType: "veryare",
		settings: { explorationSeconds: 60 },
	},
	{ type: "join-room", gameType: "veryare", roomId: "room-1" },
	{ type: "leave-room", roomId: "room-1" },
	{ type: "reconnect", roomId: "room-1", resumeToken: "secret-token" },
	{
		type: "game-event",
		gameType: "veryare",
		roomId: "room-1",
		payload: { type: "move", x: 1.5, z: -2 },
	},
	{ type: "pong" },
] satisfies ClientMessage[];

export const serverMessageSamples = [
	{
		type: "room-list",
		gameType: "veryare",
		rooms: [
			{
				roomId: "room-1",
				gameType: "veryare",
				playerCount: 2,
				capacity: 5,
				status: "waiting",
			},
			{
				roomId: "room-2",
				gameType: "veryare",
				playerCount: 5,
				capacity: 5,
				status: "playing",
			},
		],
	},
	{
		type: "room-joined",
		gameType: "veryare",
		roomId: "room-1",
		you: "p-2",
		players: [
			{ playerId: "p-1", name: "user1" },
			{ playerId: "p-2", name: "user2" },
		],
	},
	{
		type: "player-joined",
		roomId: "room-1",
		player: { playerId: "p-3", name: "user3" },
	},
	{ type: "player-left", roomId: "room-1", playerId: "p-3" },
	{ type: "game-started", gameType: "tilt-maze", roomId: "room-9" },
	{
		type: "game-state",
		gameType: "veryare",
		roomId: "room-1",
		payload: {
			type: "phase",
			phase: "oni-selection",
			durationMs: null,
			oni: null,
			outcome: null,
			area: "ready",
			flags: [true, false],
			ratio: 0.5,
		},
	},
	{
		type: "game-state-to",
		gameType: "veryare",
		roomId: "room-1",
		to: "p-2",
		payload: { type: "positions", seen: [] },
	},
	{
		type: "game-ended",
		gameType: "tilt-maze",
		roomId: "room-9",
		result: {
			order: "lower-is-better",
			rankings: [
				{
					playerId: "p-1",
					name: "user1",
					rank: 1,
					result: { score: 12.5, details: { level: 10, note: "clear" } },
				},
				{ playerId: "p-2", name: "user2", rank: 2, result: { score: 30 } },
			],
		},
	},
	{ type: "error", code: "room-full", message: "そのルームは満員です。" },
	{ type: "session", playerId: "p-2", resumeToken: "secret-token" },
	{ type: "ping" },
] satisfies ServerMessage[];
