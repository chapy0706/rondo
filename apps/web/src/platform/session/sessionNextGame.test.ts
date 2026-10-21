import type { RealtimeResult, ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	INITIAL_SESSION,
	type SessionState,
	isSpectatorIn,
	reduceSession,
} from "./session";

/**
 * 観戦ルームの次の試合（issue-67）。同じルームの中で、結果のあとに次の試合が始まる（game-started）。
 * 画面が結果を出したままにならないよう、自分のルームの game-started で、結果と閉じるまでの残りを消す。
 * 対戦のルームでは、結果のあとに game-started は来ない（結果を消す場面は無い）。
 */

function server(current: SessionState, message: ServerMessage): SessionState {
	return reduceSession(current, { type: "server", message });
}

const result: RealtimeResult = { order: "higher-is-better", rankings: [] };

const inRoom = (roomId: string): SessionState =>
	server(INITIAL_SESSION, {
		type: "room-joined",
		gameType: "veryare",
		roomId,
		you: "s-1",
		players: [{ playerId: "cpu-1", name: "CPU 1" }],
	});

describe("次の試合の始まり（game-started / issue-67）", () => {
	it("自分のルームの game-started で、結果と閉じるまでの残りを消す（ルームはそのまま）", () => {
		const ended = server(inRoom("r-1"), {
			type: "game-ended",
			gameType: "veryare",
			roomId: "r-1",
			result,
		});
		expect(ended.result).not.toBeNull();
		const next = server(ended, {
			type: "game-started",
			gameType: "veryare",
			roomId: "r-1",
		});
		expect(next.result).toBeNull();
		expect(next.closesInMs).toBeNull();
		expect(next.room).toEqual(ended.room);
	});

	it("ほかのルームの game-started は、無視する", () => {
		const ended = server(inRoom("r-1"), {
			type: "game-ended",
			gameType: "veryare",
			roomId: "r-1",
			result,
		});
		const other = server(ended, {
			type: "game-started",
			gameType: "veryare",
			roomId: "r-2",
		});
		expect(other).toBe(ended);
	});
});

describe("isSpectatorIn - 観戦者として入っているか（issue-67）", () => {
	const cpus = [
		{ playerId: "cpu-1", name: "CPU 1" },
		{ playerId: "cpu-2", name: "CPU 2" },
	];

	it("観戦ルームでは、自分は参加者の一覧に載らない", () => {
		expect(isSpectatorIn("s-1", cpus)).toBe(true);
	});

	it("対戦のルームでは、自分は参加者に載る。ルームに入る前は false", () => {
		expect(isSpectatorIn("cpu-2", cpus)).toBe(false);
		expect(isSpectatorIn(null, cpus)).toBe(false);
		expect(isSpectatorIn("s-1", [])).toBe(false);
	});
});
