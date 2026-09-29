import type { ServerMessage } from "@rondo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockWebSocketAdapter } from "./MockWebSocketAdapter";
import { MOCK_BOTS, veryareScript } from "./mockVeryare";

function payloadOf(message: ServerMessage): Record<string, unknown> {
	if (message.type !== "game-state") throw new Error(message.type);
	return message.payload as Record<string, unknown>;
}

describe("veryareScript - 時間で進む簡易な台本", () => {
	const script = (selfIsOni: boolean) =>
		veryareScript({
			roomId: "room-1",
			self: "me",
			selfIsOni,
			explorationSeconds: 60,
		});

	it("入室後の案内で探索時間を伝える", () => {
		const [first] = script(true);
		expect(first?.afterMs).toBe(0);
		expect(payloadOf(first?.message as ServerMessage)).toEqual({
			type: "room-info",
			explorationSeconds: 60,
		});
	});

	it("鬼選出 → 準備 → ペイント → 探索 → 終了 を、決まった時刻に通知する", () => {
		const phases = script(true)
			.slice(1)
			.map(({ afterMs, message }) => [afterMs, payloadOf(message).phase]);
		expect(phases).toEqual([
			[0, "oni-selection"],
			[10_000, "preparation"],
			[30_000, "painting"],
			[50_000, "exploration"],
			[110_000, "ended"],
		]);
	});

	it("自分が鬼の回と、仮のプレイヤーが鬼の回を作れる", () => {
		const oniOf = (selfIsOni: boolean) =>
			payloadOf((script(selfIsOni)[2] as { message: ServerMessage }).message)
				.oni;
		expect(oniOf(true)).toBe("me");
		expect(oniOf(false)).toBe(MOCK_BOTS[0]?.playerId);
	});

	it("通知の形はサーバーと同じ（type / phase / durationMs / oni / outcome）", () => {
		const ended = script(true).at(-1);
		expect(payloadOf(ended?.message as ServerMessage)).toEqual({
			type: "phase",
			phase: "ended",
			durationMs: null,
			oni: "me",
			outcome: "hiders-win",
		});
	});
});

describe("MockWebSocketAdapter - veryare の模擬", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function play(settings?: Readonly<Record<string, number>>) {
		const adapter = new MockWebSocketAdapter();
		const received: ServerMessage[] = [];
		adapter.subscribe((message) => received.push(message));
		adapter.send(
			settings === undefined
				? { type: "create-room", gameType: "veryare" }
				: { type: "create-room", gameType: "veryare", settings },
		);
		return { adapter, received };
	}

	function oniAfterSelection(received: readonly ServerMessage[]) {
		const preparation = received
			.filter((m) => m.type === "game-state")
			.map(payloadOf)
			.find((p) => p.phase === "preparation");
		return preparation?.oni;
	}

	it("仮のプレイヤーが固定で参加し、1回目は自分が鬼、2回目は仮のプレイヤーが鬼", () => {
		vi.useFakeTimers();

		const first = play();
		vi.advanceTimersByTime(10_100);
		const joined = first.received.find((m) => m.type === "room-joined");
		if (joined?.type !== "room-joined") throw new Error("not joined");
		expect(joined.players.map((p) => p.playerId)).toEqual([
			joined.you,
			...MOCK_BOTS.map((bot) => bot.playerId),
		]);
		expect(oniAfterSelection(first.received)).toBe(joined.you);
		first.adapter.close();

		const second = play();
		vi.advanceTimersByTime(10_100);
		expect(oniAfterSelection(second.received)).toBe(MOCK_BOTS[0]?.playerId);
		second.adapter.close();
	});

	it("作成時に選んだ探索時間が、入室後の案内に載る（省略時は 40 秒）", () => {
		vi.useFakeTimers();
		const chosen = play({ explorationSeconds: 80 });
		const defaulted = play();
		vi.advanceTimersByTime(100);

		const info = (received: readonly ServerMessage[]) =>
			received
				.filter((m) => m.type === "game-state")
				.map(payloadOf)
				.find((p) => p.type === "room-info")?.explorationSeconds;
		expect(info(chosen.received)).toBe(80);
		expect(info(defaulted.received)).toBe(40);
		chosen.adapter.close();
		defaulted.adapter.close();
	});

	it("閉じたら台本のタイマーも止まる", () => {
		vi.useFakeTimers();
		const { adapter, received } = play();
		vi.advanceTimersByTime(100);
		const count = received.length;
		adapter.close();
		vi.advanceTimersByTime(200_000);
		expect(received.length).toBe(count);
	});
});
