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

	it("鬼選出（赤 → 緑 → 青）→ 準備 → ペイント → 探索 → 答え合わせ → 終了 を、決まった時刻に通知する", () => {
		const phases = script(true)
			.slice(1)
			.filter(({ message }) => payloadOf(message).type === "phase")
			.map(({ afterMs, message }) => {
				const payload = payloadOf(message);
				return [afterMs, payload.phase, payload.area];
			});
		expect(phases).toEqual([
			[0, "oni-selection", "waiting"],
			[3_000, "oni-selection", "ready"],
			[6_000, "oni-selection", "counting"],
			[16_000, "preparation", null],
			[36_000, "painting", null],
			[56_000, "exploration", null],
			[116_000, "reveal", null],
			[136_000, "ended", null],
		]);
	});

	it("探索の開始と同時に、隠れ側の状態を一括で送る（CPU なしなら仮のプレイヤーは null の状態）", () => {
		const hiders = script(true).find(
			({ message }) => payloadOf(message).type === "hiders",
		);
		expect(hiders?.afterMs).toBe(56_000);
		const states = payloadOf(hiders?.message as ServerMessage)
			.hiders as readonly Record<string, unknown>[];
		expect(states.map((h) => h.playerId)).toEqual(
			MOCK_BOTS.map((bot) => bot.playerId),
		);
		expect(states.every((h) => h.paint === null)).toBe(true);
	});

	it("青（カウント中）の通知は10秒の残り時間を持つ", () => {
		const counting = script(true)
			.map(({ message }) => payloadOf(message))
			.find((payload) => payload.area === "counting");
		expect(counting?.durationMs).toBe(10_000);
	});

	it("自分が鬼の回と、仮のプレイヤーが鬼の回を作れる", () => {
		const oniOf = (selfIsOni: boolean) =>
			script(selfIsOni)
				.map(({ message }) => payloadOf(message))
				.find((payload) => payload.phase === "preparation")?.oni;
		expect(oniOf(true)).toBe("me");
		expect(oniOf(false)).toBe(MOCK_BOTS[0]?.playerId);
	});

	it("通知の形はサーバーと同じ（type / phase / durationMs / oni / outcome / area）", () => {
		const reveal = script(true).at(-2);
		expect(payloadOf(reveal?.message as ServerMessage)).toEqual({
			type: "phase",
			phase: "reveal",
			durationMs: 20_000,
			oni: "me",
			outcome: "hiders-win",
			area: null,
		});
		const ended = script(true).at(-1);
		expect(payloadOf(ended?.message as ServerMessage)).toEqual({
			type: "phase",
			phase: "ended",
			durationMs: null,
			oni: "me",
			outcome: "hiders-win",
			area: null,
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
		vi.advanceTimersByTime(16_100);
		const joined = first.received.find((m) => m.type === "room-joined");
		if (joined?.type !== "room-joined") throw new Error("not joined");
		expect(joined.players.map((p) => p.playerId)).toEqual([
			joined.you,
			...MOCK_BOTS.map((bot) => bot.playerId),
		]);
		expect(oniAfterSelection(first.received)).toBe(joined.you);
		first.adapter.close();

		const second = play();
		vi.advanceTimersByTime(16_100);
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

	it("隠れ側 CPU を選ぶと、CPU N が参加し、自分が鬼になり、探索開始時に CPU の状態が届く", () => {
		vi.useFakeTimers();
		const { adapter, received } = play({ cpu: 2 });
		vi.advanceTimersByTime(56_100);
		const joined = received.find((m) => m.type === "room-joined");
		if (joined?.type !== "room-joined") throw new Error("not joined");
		expect(joined.players).toEqual([
			{ playerId: joined.you, name: expect.any(String) },
			{ playerId: "cpu-1", name: "CPU 1" },
			{ playerId: "cpu-2", name: "CPU 2" },
		]);
		expect(oniAfterSelection(received)).toBe(joined.you);

		const hiders = received
			.filter((m) => m.type === "game-state")
			.map(payloadOf)
			.find((p) => p.type === "hiders");
		const states = hiders?.hiders as readonly Record<string, unknown>[];
		expect(states.map((h) => h.playerId)).toEqual(["cpu-1", "cpu-2"]);
		for (const state of states) {
			expect(state.paint).toEqual({
				kind: "uniform",
				color: expect.any(String),
			});
		}
		adapter.close();
	});

	it("鬼 CPU を選ぶと、CPU 1 が鬼になる", () => {
		vi.useFakeTimers();
		const { adapter, received } = play({ cpu: 4 });
		vi.advanceTimersByTime(16_100);
		const joined = received.find((m) => m.type === "room-joined");
		if (joined?.type !== "room-joined") throw new Error("not joined");
		expect(joined.players.map((p) => p.playerId)).toEqual([
			joined.you,
			"cpu-1",
		]);
		expect(oniAfterSelection(received)).toBe("cpu-1");
		adapter.close();
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
