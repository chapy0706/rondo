import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	INITIAL_SESSION,
	ReplayBuffer,
	type SessionState,
	lobbyShouldEnter,
	playEntry,
	playStatus,
	reduceSession,
	roomJoinedAction,
} from "./session";

const joined = (
	roomId: string,
	gameType = "veryare",
	you = "p-b",
): ServerMessage => ({
	type: "room-joined",
	gameType,
	roomId,
	you,
	players: [
		{ playerId: "p-a", name: "user1" },
		{ playerId: you, name: "user2" },
	],
});

const state = (roomId: string, payload: unknown): ServerMessage => ({
	type: "game-state",
	gameType: "veryare",
	roomId,
	payload,
});

function server(current: SessionState, message: ServerMessage): SessionState {
	return reduceSession(current, { type: "server", message });
}

function inRoom(roomId = "room-1"): SessionState {
	return server(
		reduceSession(INITIAL_SESSION, {
			type: "request",
			kind: "join",
			gameType: "veryare",
		}),
		joined(roomId),
	);
}

describe("reduceSession - ルームの状態の遷移（issue-40）", () => {
	it("参加を頼むと待ちになり、room-joined で参加中になる", () => {
		const pending = reduceSession(INITIAL_SESSION, {
			type: "request",
			kind: "join",
			gameType: "veryare",
		});
		expect(pending.pending).toEqual({ kind: "join", gameType: "veryare" });
		const next = server(pending, joined("room-1"));
		expect(next.pending).toBeNull();
		expect(next.room).toEqual({
			gameType: "veryare",
			roomId: "room-1",
			you: "p-b",
			players: [
				{ playerId: "p-a", name: "user1" },
				{ playerId: "p-b", name: "user2" },
			],
		});
	});

	it("頼んでいない room-joined（再接続の復帰）でも参加中になる", () => {
		expect(server(INITIAL_SESSION, joined("room-9")).room?.roomId).toBe(
			"room-9",
		);
	});

	it("player-joined / player-left で、参加中のルームの顔ぶれだけを更新する", () => {
		let current = inRoom();
		current = server(current, {
			type: "player-joined",
			roomId: "room-1",
			player: { playerId: "p-c", name: "user3" },
		});
		expect(current.room?.players.map((p) => p.playerId)).toEqual([
			"p-a",
			"p-b",
			"p-c",
		]);
		current = server(current, {
			type: "player-left",
			roomId: "room-1",
			playerId: "p-a",
		});
		expect(current.room?.players.map((p) => p.playerId)).toEqual([
			"p-b",
			"p-c",
		]);
		// ほかのルームの通知は無視する。
		const other = server(current, {
			type: "player-left",
			roomId: "room-2",
			playerId: "p-b",
		});
		expect(other).toBe(current);
	});

	it("参加中のルームの game-ended を結果として持つ。ほかのルームのものは持たない", () => {
		const result = {
			order: "lower-is-better" as const,
			rankings: [],
		};
		const ended = server(inRoom(), {
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-1",
			result,
		});
		expect(ended.result).toEqual(result);
		const other = server(inRoom(), {
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-2",
			result,
		});
		expect(other.result).toBeNull();
	});

	it("エラーで待ちを解き、文言を持つ。参加中のルームは保つ", () => {
		const pending = reduceSession(INITIAL_SESSION, {
			type: "request",
			kind: "join",
			gameType: "veryare",
		});
		const failed = server(pending, {
			type: "error",
			code: "room-full",
			message: "そのルームは満員です。",
		});
		expect(failed.pending).toBeNull();
		expect(failed.error).toBe("そのルームは満員です。");
		expect(
			server(inRoom(), { type: "error", code: "x", message: "m" }).room?.roomId,
		).toBe("room-1");
	});

	it("再接続に失敗したら、参加中のルームを忘れる", () => {
		const failed = server(
			reduceSession(INITIAL_SESSION, {
				type: "request",
				kind: "resume",
				gameType: "veryare",
			}),
			{ type: "error", code: "reconnect-failed", message: "戻れなかった" },
		);
		expect(failed.pending).toBeNull();
		expect(failed.room).toBeNull();
		expect(failed.error).toBe("戻れなかった");
	});

	it("退出で、ルーム・結果・待ちを消す", () => {
		const left = reduceSession(inRoom(), { type: "left" });
		expect(left).toEqual(INITIAL_SESSION);
	});

	it("新しいルームに入ると、前の結果とエラーを消す", () => {
		let current = server(inRoom(), {
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-1",
			result: { order: "lower-is-better", rankings: [] },
		});
		current = server(current, { type: "error", code: "x", message: "m" });
		const next = server(current, joined("room-2"));
		expect(next.result).toBeNull();
		expect(next.error).toBeNull();
	});
});

describe("lobbyShouldEnter - ロビーからゲーム画面へ移るか", () => {
	it("このゲームのルームに参加中なら移る", () => {
		expect(lobbyShouldEnter(inRoom(), "veryare")).toBe(true);
	});

	it("参加していない、またはほかのゲームのルームなら移らない", () => {
		expect(lobbyShouldEnter(INITIAL_SESSION, "veryare")).toBe(false);
		expect(lobbyShouldEnter(inRoom(), "tilt-maze")).toBe(false);
	});
});

describe("playEntry - ゲーム画面を開いたときの入り方", () => {
	it("このゲームのルームに参加中なら、そのルームを開く（作らない）", () => {
		expect(playEntry(inRoom(), "veryare")).toBe("joined");
	});

	it("このゲームの参加・作成・復帰を待っているなら、待つ", () => {
		for (const kind of ["create", "join", "resume"] as const) {
			const pending = reduceSession(INITIAL_SESSION, {
				type: "request",
				kind,
				gameType: "veryare",
			});
			expect(playEntry(pending, "veryare")).toBe("waiting");
		}
	});

	it("何もなければ、新しく作る（選択画面から直接来た場合）", () => {
		expect(playEntry(INITIAL_SESSION, "veryare")).toBe("create");
	});

	it("ほかのゲームのルームにいるなら、出てから作る", () => {
		expect(playEntry(inRoom(), "tilt-maze")).toBe("leave-and-create");
	});
});

describe("ReplayBuffer - 画面が開く前に届いた通知を取りこぼさない", () => {
	it("購読より前に届いた状態を、購読した後に順に渡す", async () => {
		const buffer = new ReplayBuffer();
		buffer.record(state("room-1", { type: "room-info", n: 1 }));
		buffer.record(state("room-1", { type: "phase", n: 2 }));
		const handler = vi.fn();
		buffer.replayTo("room-1", handler, () => true);
		// 購読の同じ流れで登録される後続のハンドラに間に合うよう、少し遅らせて渡す。
		expect(handler).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(handler.mock.calls.map(([m]) => m.payload.n)).toEqual([1, 2]);
	});

	it("ルームが決まる前に届いた状態も持つ（room-joined より先に届くことがある）。ほかのルームのものは渡さない", async () => {
		const buffer = new ReplayBuffer();
		buffer.record(state("room-1", { type: "phase", n: 1 }));
		buffer.record(state("room-2", { type: "phase", n: 2 }));
		const handler = vi.fn();
		buffer.replayTo("room-1", handler, () => true);
		await Promise.resolve();
		expect(handler.mock.calls.map(([m]) => m.payload.n)).toEqual([1]);
	});

	it("限定配信（game-state-to）も持つ。ロビーの通知は持たない", async () => {
		const buffer = new ReplayBuffer();
		buffer.record({
			type: "game-state-to",
			gameType: "veryare",
			roomId: "room-1",
			to: "p-b",
			payload: { type: "secret" },
		});
		buffer.record({ type: "room-list", gameType: "veryare", rooms: [] });
		const handler = vi.fn();
		buffer.replayTo("room-1", handler, () => true);
		await Promise.resolve();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("渡す時点で購読が解かれていたら渡さず、次の購読に渡す（StrictMode の付け外し）", async () => {
		const buffer = new ReplayBuffer();
		buffer.record(state("room-1", { type: "phase", n: 1 }));
		const first = vi.fn();
		let firstActive = true;
		buffer.replayTo("room-1", first, () => firstActive);
		firstActive = false;
		const second = vi.fn();
		buffer.replayTo("room-1", second, () => true);
		await Promise.resolve();
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("一度渡したルームは、以後ためない（画面が状態を持つ）", async () => {
		const buffer = new ReplayBuffer();
		buffer.record(state("room-1", { type: "phase", n: 1 }));
		buffer.replayTo("room-1", vi.fn(), () => true);
		await Promise.resolve();
		buffer.record(state("room-1", { type: "phase", n: 2 }));
		expect(buffer.size).toBe(0);
	});

	it("ためる数には上限があり、古いものから捨てる", () => {
		const buffer = new ReplayBuffer(3);
		for (let n = 0; n < 5; n++)
			buffer.record(state("room-1", { type: "x", n }));
		expect(buffer.size).toBe(3);
	});

	it("reset で、ためた状態と渡し済みの印を消す", () => {
		const buffer = new ReplayBuffer();
		buffer.record(state("room-1", { type: "phase" }));
		buffer.reset();
		expect(buffer.size).toBe(0);
	});
});

describe("reduceSession - タイムアウトと接続の失敗（issue-47）", () => {
	const pending = (kind: "create" | "join" | "resume" = "create") =>
		reduceSession(INITIAL_SESSION, {
			type: "request",
			kind,
			gameType: "veryare",
		});

	it("返事を待っている間に時間切れになると、待ちを解いて失敗にする", () => {
		const timedOut = reduceSession(pending(), { type: "timeout" });
		expect(timedOut.pending).toBeNull();
		expect(timedOut.failure).toBe("timeout");
	});

	it("待っていなければ、時間切れは何もしない", () => {
		const joined = server(pending(), joined_("room-1"));
		expect(reduceSession(joined, { type: "timeout" })).toBe(joined);
	});

	it("再接続がすべて失敗したら、ルームと待ちを忘れて失敗にする", () => {
		const lost = reduceSession(inRoom(), { type: "connection-lost" });
		expect(lost.room).toBeNull();
		expect(lost.pending).toBeNull();
		expect(lost.failure).toBe("connection-lost");
	});

	it("ルームにも入らず、何も待っていなければ、接続の失敗は表示しない（次の頼みで分かる）", () => {
		expect(
			reduceSession(INITIAL_SESSION, { type: "connection-lost" }).failure,
		).toBeNull();
	});

	it("新しく頼むと、失敗の表示を消す", () => {
		const failed = reduceSession(pending(), { type: "timeout" });
		expect(
			reduceSession(failed, {
				type: "request",
				kind: "create",
				gameType: "veryare",
			}).failure,
		).toBeNull();
	});

	it("dismiss で、失敗とエラーの表示を消す", () => {
		const failed = reduceSession(pending(), { type: "timeout" });
		const cleared = reduceSession(failed, { type: "dismiss" });
		expect(cleared.failure).toBeNull();
		expect(cleared.error).toBeNull();
	});

	it("room-joined が届いたら、失敗の表示を消す（遅れて届いた返事を受け入れた）", () => {
		const failed = reduceSession(pending(), { type: "timeout" });
		expect(server(failed, joined_("room-1")).failure).toBeNull();
	});
});

/** 名前の重なりを避けるための別名。 */
function joined_(roomId: string): ServerMessage {
	return joined(roomId);
}

describe("roomJoinedAction - 届いた room-joined を受け入れるか（取り残しの防止）", () => {
	it("待っている画面があれば受け入れる", () => {
		expect(roomJoinedAction(INITIAL_SESSION, "room-1", true)).toBe("accept");
	});

	it("画面がなければ、すぐに出る（返事の前に画面を離れた）", () => {
		expect(roomJoinedAction(INITIAL_SESSION, "room-1", false)).toBe("leave");
	});

	it("すでに別のルームにいれば、新しく届いたほうから出る", () => {
		expect(roomJoinedAction(inRoom("room-1"), "room-2", true)).toBe("leave");
	});

	it("同じルームの room-joined（再接続での復帰）は受け入れる", () => {
		expect(roomJoinedAction(inRoom("room-1"), "room-1", true)).toBe("accept");
	});
});

describe("playStatus - ゲーム画面に何を出すか", () => {
	it("このゲームのルームに入っていれば joined", () => {
		expect(playStatus(inRoom(), "veryare")).toBe("joined");
	});

	it("失敗していれば failed（ルームに入っていなければ）", () => {
		const failed = reduceSession(
			reduceSession(INITIAL_SESSION, {
				type: "request",
				kind: "create",
				gameType: "veryare",
			}),
			{ type: "timeout" },
		);
		expect(playStatus(failed, "veryare")).toBe("failed");
		expect(
			playStatus(
				reduceSession(inRoom(), { type: "connection-lost" }),
				"veryare",
			),
		).toBe("failed");
	});

	it("それ以外は connecting（返事を待っている、またはこれから頼む）", () => {
		expect(playStatus(INITIAL_SESSION, "veryare")).toBe("connecting");
	});
});
