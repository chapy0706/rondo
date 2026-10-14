import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { playersSeen } from "./views.ts";

const joined = (ids: string[]): ServerMessage => ({
	type: "room-joined",
	gameType: "veryare",
	roomId: "r",
	you: ids[0] ?? "",
	players: ids.map((id) => ({ playerId: id, name: id })),
});

describe("playersSeen - ボットが見ている参加者（issue-51 の乱れた通信の確かめ）", () => {
	it("最後の room-joined の一覧に、その後の参加・退出の知らせを当てる", () => {
		const messages: ServerMessage[] = [
			joined(["a", "b"]),
			{
				type: "player-joined",
				roomId: "r",
				player: { playerId: "c", name: "c" },
			},
			{ type: "player-left", roomId: "r", playerId: "b" },
		];
		expect([...playersSeen(messages, "r")].sort()).toEqual(["a", "c"]);
	});

	it("復帰で届き直した room-joined からやり直す（前の知らせは使わない）", () => {
		const messages: ServerMessage[] = [
			joined(["a", "b"]),
			{ type: "player-left", roomId: "r", playerId: "b" },
			joined(["a", "b", "d"]),
		];
		expect([...playersSeen(messages, "r")].sort()).toEqual(["a", "b", "d"]);
	});

	it("別のルームの知らせは使わない。room-joined が無ければ空", () => {
		const messages: ServerMessage[] = [
			joined(["a"]),
			{
				type: "player-joined",
				roomId: "x",
				player: { playerId: "z", name: "z" },
			},
		];
		expect([...playersSeen(messages, "r")]).toEqual(["a"]);
		expect(playersSeen([], "r").size).toBe(0);
	});
});
