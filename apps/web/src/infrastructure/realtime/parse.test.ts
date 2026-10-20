import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./parse";

describe("parseServerMessage - game-state-to（限定配信 / ADR 0021）", () => {
	const valid = {
		type: "game-state-to",
		gameType: "chameleon",
		roomId: "room-1",
		to: "p1",
		payload: { type: "positions", seen: [] },
	};

	it("宛先付きの限定配信を通す（payload はゲーム側で検証するため unknown のまま）", () => {
		expect(parseServerMessage(valid)).toEqual(valid);
	});

	it.each(["gameType", "roomId", "to"])(
		"%s が文字列でなければ捨てる",
		(key) => {
			expect(parseServerMessage({ ...valid, [key]: 1 })).toBeNull();
		},
	);

	it("既存の game-state はこれまでどおり通す", () => {
		const broadcast = {
			type: "game-state",
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { type: "rank" },
		};
		expect(parseServerMessage(broadcast)).toEqual(broadcast);
	});
});

describe("parseServerMessage - session（issue-31）", () => {
	it("プレイヤー識別子と復帰トークンを通す", () => {
		const session = {
			type: "session",
			playerId: "p-1",
			resumeToken: "token-1",
		};
		expect(parseServerMessage(session)).toEqual(session);
	});

	it.each(["playerId", "resumeToken"])("%s が文字列でなければ捨てる", (key) => {
		expect(
			parseServerMessage({
				type: "session",
				playerId: "p-1",
				resumeToken: "token-1",
				[key]: 1,
			}),
		).toBeNull();
	});
});

describe("parseServerMessage - ping（ハートビート / issue-41）", () => {
	it("ping を通す（接続の層で pong を返すため）", () => {
		expect(parseServerMessage({ type: "ping" })).toEqual({ type: "ping" });
	});
});

describe("parseServerMessage - ルーム名（issue-58）", () => {
	const summary = {
		roomId: "room-1",
		gameType: "veryare",
		playerCount: 1,
		capacity: 5,
		status: "waiting",
	};
	const joined = {
		type: "room-joined",
		gameType: "veryare",
		roomId: "room-1",
		you: "p-1",
		players: [{ playerId: "p-1", name: "user1" }],
	};

	it("一覧の名前と、参加の返事の名前を通す", () => {
		const list = {
			type: "room-list",
			gameType: "veryare",
			rooms: [{ ...summary, name: "<b>部屋</b>" }],
		};
		expect(parseServerMessage(list)).toEqual(list);
		expect(parseServerMessage({ ...joined, roomName: "部屋" })).toEqual({
			...joined,
			roomName: "部屋",
		});
	});

	it("名前なしの古い形も読める", () => {
		const list = { type: "room-list", gameType: "veryare", rooms: [summary] };
		expect(parseServerMessage(list)).toEqual(list);
		expect(parseServerMessage(joined)).toEqual(joined);
	});

	it("名前が文字列でなければ捨てる", () => {
		expect(
			parseServerMessage({
				type: "room-list",
				gameType: "veryare",
				rooms: [{ ...summary, name: 1 }],
			}),
		).toBeNull();
		expect(parseServerMessage({ ...joined, roomName: null })).toBeNull();
	});
});

describe("parseServerMessage - game-ended の閉じるまでの残り（issue-70）", () => {
	const ended = {
		type: "game-ended",
		gameType: "veryare",
		roomId: "room-1",
		result: { order: "lower-is-better", rankings: [] },
	};

	it("closesInMs（0 以上の数）を通す", () => {
		expect(parseServerMessage({ ...ended, closesInMs: 180000 })).toEqual({
			...ended,
			closesInMs: 180000,
		});
		expect(parseServerMessage({ ...ended, closesInMs: 0 })).toEqual({
			...ended,
			closesInMs: 0,
		});
	});

	it("無い古い形も読める", () => {
		expect(parseServerMessage(ended)).toEqual(ended);
	});

	it("数でない・負の・有限でない closesInMs は捨てる（結果は読む）", () => {
		for (const closesInMs of ["180000", -1, Number.NaN, null]) {
			expect(parseServerMessage({ ...ended, closesInMs })).toEqual(ended);
		}
	});
});

describe("parseServerMessage - 観戦ルームの印（issue-67）", () => {
	const room = {
		roomId: "room-5",
		gameType: "veryare",
		playerCount: 2,
		capacity: 20,
		status: "playing",
	};

	it("spectate: true を通す", () => {
		expect(
			parseServerMessage({
				type: "room-list",
				gameType: "veryare",
				rooms: [{ ...room, spectate: true }],
			}),
		).toEqual({
			type: "room-list",
			gameType: "veryare",
			rooms: [{ ...room, spectate: true }],
		});
	});

	it("無い古い形と、true でない値は、印なし（人間の対戦）", () => {
		for (const spectate of [undefined, false, "true", 1]) {
			expect(
				parseServerMessage({
					type: "room-list",
					gameType: "veryare",
					rooms: [spectate === undefined ? room : { ...room, spectate }],
				}),
			).toEqual({ type: "room-list", gameType: "veryare", rooms: [room] });
		}
	});
});
