import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiplexingAdapter } from "../../infrastructure/realtime/MultiplexingAdapter";
import { RealtimeSession } from "./RealtimeSession";

/** 送った電文を記録し、受信を手で起こせる偽のアダプタ。 */
class FakeAdapter extends MultiplexingAdapter {
	readonly sent: ClientMessage[] = [];
	closed = false;
	send(message: ClientMessage): void {
		this.sent.push(message);
	}
	close(): void {
		this.closed = true;
	}
	deliver(message: ServerMessage): void {
		this.dispatch(message);
	}
	reconnects = 0;
	override reconnect(): void {
		this.reconnects += 1;
	}
	/** 再接続をすべて失敗させる。 */
	giveUp(): void {
		this.notifyConnectionFailed();
	}
}

const joined = (roomId: string): ServerMessage => ({
	type: "room-joined",
	gameType: "veryare",
	roomId,
	you: "p-b",
	players: [{ playerId: "p-b", name: "user2" }],
});

const phase = (roomId: string, n: number): ServerMessage => ({
	type: "game-state",
	gameType: "veryare",
	roomId,
	payload: { type: "phase", n },
});

describe("RealtimeSession - 画面をまたいで1本の接続とルームを持つ（issue-40）", () => {
	let adapter: FakeAdapter;
	let session: RealtimeSession;

	beforeEach(() => {
		vi.useFakeTimers();
		adapter = new FakeAdapter();
		session = new RealtimeSession(adapter, { releaseDelayMs: 100 });
		// 返事を待つ画面がある状態にする（ない場合の取り残しの防止は issue-47 の節で確かめる）。
		session.watch();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("参加すると join-room を送り、room-joined で状態が変わったことを知らせる", () => {
		const listener = vi.fn();
		session.subscribeState(listener);
		session.join("veryare", "room-1");
		expect(adapter.sent).toEqual([
			{ type: "join-room", gameType: "veryare", roomId: "room-1" },
		]);
		adapter.deliver(joined("room-1"));
		expect(session.state.room?.roomId).toBe("room-1");
		expect(listener).toHaveBeenCalled();
	});

	it("作成を待っている間に、もう一度作成を頼んでも1回しか送らない", () => {
		session.create("veryare");
		session.create("veryare");
		expect(adapter.sent).toEqual([
			{ type: "create-room", gameType: "veryare" },
		]);
	});

	it("作成のときに設定を渡せる", () => {
		session.create("veryare", { cpu: 2 });
		expect(adapter.sent).toEqual([
			{ type: "create-room", gameType: "veryare", settings: { cpu: 2 } },
		]);
	});

	it("退出で leave-room を送り、ルームを忘れる", () => {
		adapter.deliver(joined("room-1"));
		session.leave();
		expect(adapter.sent).toEqual([{ type: "leave-room", roomId: "room-1" }]);
		expect(session.state.room).toBeNull();
	});

	it("ゲーム画面が離れたまま戻らなければ、少し待ってから退出する", () => {
		adapter.deliver(joined("room-1"));
		const release = session.hold();
		release();
		expect(adapter.sent).toEqual([]);
		vi.advanceTimersByTime(100);
		expect(adapter.sent).toEqual([{ type: "leave-room", roomId: "room-1" }]);
	});

	it("離れてすぐ戻れば（StrictMode の付け外し）、退出しない", () => {
		adapter.deliver(joined("room-1"));
		session.hold()();
		session.hold();
		vi.advanceTimersByTime(1000);
		expect(adapter.sent).toEqual([]);
	});

	it("ゲームの口は、画面が開く前に届いた状態を先に渡し、その後の通知も渡す", async () => {
		adapter.deliver(phase("room-1", 1));
		adapter.deliver(joined("room-1"));
		adapter.deliver(phase("room-1", 2));
		const received: number[] = [];
		session.gamePort("room-1").subscribe((message) => {
			if (message.type === "game-state") {
				received.push((message.payload as { n: number }).n);
			}
		});
		await Promise.resolve();
		adapter.deliver(phase("room-1", 3));
		expect(received).toEqual([1, 2, 3]);
	});

	it("ゲームの口の送信は、そのまま接続へ流す", () => {
		session.gamePort("room-1").send({
			type: "game-event",
			gameType: "veryare",
			roomId: "room-1",
			payload: { type: "move" },
		});
		expect(adapter.sent.map((m) => m.type)).toEqual(["game-event"]);
	});

	it("覚えた復帰先があれば、最初から復帰を待つ状態で始まる", () => {
		const resuming = new RealtimeSession(new FakeAdapter(), {
			resumeGameType: "veryare",
		});
		expect(resuming.state.pending).toEqual({
			kind: "resume",
			gameType: "veryare",
		});
	});
});

describe("RealtimeSession - タイムアウトと取り残しの防止（issue-47）", () => {
	let adapter: FakeAdapter;
	let session: RealtimeSession;

	beforeEach(() => {
		vi.useFakeTimers();
		adapter = new FakeAdapter();
		session = new RealtimeSession(adapter, {
			releaseDelayMs: 100,
			requestTimeoutMs: 1000,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("返事が時間内に届かなければ、失敗にする（時間は差し替えられる）", () => {
		session.hold();
		session.create("veryare");
		vi.advanceTimersByTime(999);
		expect(session.state.failure).toBeNull();
		vi.advanceTimersByTime(1);
		expect(session.state.failure).toBe("timeout");
		expect(session.state.pending).toBeNull();
	});

	it("時間内に届けば、後から失敗にはしない", () => {
		session.hold();
		session.create("veryare");
		adapter.deliver(joined("room-1"));
		vi.advanceTimersByTime(5000);
		expect(session.state.failure).toBeNull();
		expect(session.state.room?.roomId).toBe("room-1");
	});

	it("時間切れの後でも、画面があれば遅れて届いた返事を受け入れる", () => {
		session.hold();
		session.create("veryare");
		vi.advanceTimersByTime(1000);
		adapter.deliver(joined("room-1"));
		expect(session.state.room?.roomId).toBe("room-1");
		expect(session.state.failure).toBeNull();
		expect(adapter.sent.map((m) => m.type)).toEqual(["create-room"]);
	});

	it("作成の返事の前に画面を離れたら、遅れて届いた room-joined ですぐに出る", () => {
		const release = session.hold();
		session.create("veryare");
		release();
		vi.advanceTimersByTime(100);
		adapter.deliver(joined("room-1"));
		expect(adapter.sent).toEqual([
			{ type: "create-room", gameType: "veryare" },
			{ type: "leave-room", roomId: "room-1" },
		]);
		expect(session.state.room).toBeNull();
	});

	it("離れてすぐ（退出の待ちの間）に届いても、画面がなければ出る", () => {
		const release = session.hold();
		session.create("veryare");
		release();
		adapter.deliver(joined("room-1"));
		expect(adapter.sent.at(-1)).toEqual({
			type: "leave-room",
			roomId: "room-1",
		});
		expect(session.state.room).toBeNull();
	});

	it("ロビーが見ている間に届いた参加の返事は受け入れ、ロビーを離れても退出しない", () => {
		const unwatch = session.watch();
		session.join("veryare", "room-1");
		adapter.deliver(joined("room-1"));
		unwatch();
		vi.advanceTimersByTime(1000);
		expect(session.state.room?.roomId).toBe("room-1");
		expect(adapter.sent.map((m) => m.type)).toEqual(["join-room"]);
	});

	it("参加の返事の前にロビーを離れたら、遅れて届いた room-joined ですぐに出る", () => {
		const unwatch = session.watch();
		session.join("veryare", "room-1");
		unwatch();
		adapter.deliver(joined("room-1"));
		expect(adapter.sent.at(-1)).toEqual({
			type: "leave-room",
			roomId: "room-1",
		});
	});

	it("すでにルームにいるときに、別のルームの room-joined が届いたら、そちらから出る", () => {
		session.hold();
		adapter.deliver(joined("room-1"));
		adapter.deliver(joined("room-2"));
		expect(session.state.room?.roomId).toBe("room-1");
		expect(adapter.sent).toEqual([{ type: "leave-room", roomId: "room-2" }]);
	});

	it("出たルームの通知は、ため置きに残さない", async () => {
		adapter.deliver(phase("room-1", 1));
		adapter.deliver(joined("room-1"));
		session.hold();
		adapter.deliver(joined("room-1"));
		const received: number[] = [];
		session.gamePort("room-1").subscribe((message) => {
			if (message.type === "game-state") {
				received.push((message.payload as { n: number }).n);
			}
		});
		await Promise.resolve();
		// 1通目の room-joined の時点では画面がなく、出たので、その前の状態は渡さない。
		expect(received).toEqual([]);
	});

	it("再接続がすべて失敗したら、失敗にする。次に頼むときは、接続をやり直してから送る", () => {
		session.hold();
		adapter.deliver(joined("room-1"));
		adapter.giveUp();
		expect(session.state.failure).toBe("connection-lost");
		expect(session.state.room).toBeNull();

		session.create("veryare");
		expect(adapter.reconnects).toBe(1);
		expect(adapter.sent.at(-1)).toEqual({
			type: "create-room",
			gameType: "veryare",
		});
	});

	it("接続をやり直した後は、次の頼みで重ねてやり直さない", () => {
		adapter.giveUp();
		session.create("veryare");
		session.leave();
		session.create("veryare");
		expect(adapter.reconnects).toBe(1);
	});
});
