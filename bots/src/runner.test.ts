import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import type { SocketLike } from "./client.ts";
import { runScenario, seeded } from "./runner.ts";
import { type Scenario, details } from "./scenario.ts";

type Listener = (event: { readonly data?: unknown }) => void;

/** 偽物のソケット。サーバー役（FakeServer）とつながる。 */
class FakeSocket implements SocketLike {
	readonly listeners: Record<string, Listener[]> = {};
	readonly server: FakeServer;
	constructor(server: FakeServer) {
		this.server = server;
	}
	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners[type] ?? [];
		list.push(listener);
		this.listeners[type] = list;
	}
	send(data: string): void {
		this.server.receive(this, JSON.parse(data) as ClientMessage);
	}
	close(): void {
		this.emit("close", {});
	}
	deliver(message: ServerMessage): void {
		queueMicrotask(() =>
			this.emit("message", { data: JSON.stringify(message) }),
		);
	}
	emit(type: string, event: { readonly data?: unknown }): void {
		for (const listener of this.listeners[type] ?? []) listener(event);
	}
}

/**
 * 台本どおりに返す、偽物のサーバー。veryare の判定は持たず、テストが決めた時点で
 * フェーズの通知と game-ended を送るだけ。
 */
class FakeServer {
	readonly log: { player: string; message: ClientMessage }[] = [];
	readonly players = new Map<FakeSocket, string>();
	readonly names = new Map<string, string>();
	readonly inRoom = new Set<FakeSocket>();
	onEvent: (
		server: FakeServer,
		player: string,
		message: ClientMessage,
	) => void = () => {};

	connect(): FakeSocket {
		const socket = new FakeSocket(this);
		const id = `p-${this.players.size + 1}`;
		this.players.set(socket, id);
		queueMicrotask(() => {
			socket.emit("open", {});
			socket.deliver({ type: "session", playerId: id, resumeToken: "t" });
		});
		return socket;
	}

	receive(socket: FakeSocket, message: ClientMessage): void {
		const player = this.players.get(socket) as string;
		this.log.push({ player, message });
		switch (message.type) {
			case "set-name":
				this.names.set(player, message.name);
				break;
			case "create-room":
			case "join-room":
				this.inRoom.add(socket);
				socket.deliver({
					type: "room-joined",
					gameType: "veryare",
					roomId: "room-1",
					you: player,
					players: [],
				});
				break;
			case "leave-room":
				this.inRoom.delete(socket);
				break;
		}
		this.onEvent(this, player, message);
	}

	broadcast(message: ServerMessage): void {
		for (const socket of this.inRoom) socket.deliver(message);
	}

	phase(name: string, area: string | null = null): void {
		this.broadcast({
			type: "game-state",
			gameType: "veryare",
			roomId: "room-1",
			payload: { type: "phase", phase: name, area },
		});
	}

	ended(
		rows: {
			player: string;
			rank: number;
			score: number;
			details: Record<string, string>;
		}[],
	): void {
		this.broadcast({
			type: "game-ended",
			gameType: "veryare",
			roomId: "room-1",
			result: {
				order: "higher-is-better",
				rankings: rows.map((row) => ({
					playerId: row.player,
					name: this.names.get(row.player) ?? row.player,
					rank: row.rank,
					result: { score: row.score, details: row.details },
				})),
			},
		});
	}
}

const scenario: Scenario = {
	name: "鬼の離脱",
	bots: ["bot-a", "bot-b"],
	steps: [
		{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
		{ on: { phase: "preparation" }, bot: "bot-a", action: { type: "leave" } },
	],
	receivers: ["bot-b"],
	rankings: [
		{ bot: "bot-b", rank: 1, score: 1, details: details.hiderWon },
		{ bot: "bot-a", rank: 2, score: 0, details: details.oniLost },
	],
};

function run(server: FakeServer, s: Scenario = scenario) {
	return runScenario(s, {
		url: "ws://fake/ws",
		createSocket: () => server.connect(),
		seed: 1,
		stepTimeoutMs: 500,
		endTimeoutMs: 500,
	});
}

/** 立候補で準備移動へ、鬼の退出で終わる台本。 */
function oniLeavesScript(
	server: FakeServer,
	player: string,
	message: ClientMessage,
) {
	if (message.type === "game-event") server.phase("preparation");
	if (message.type === "leave-room" && player === "p-1") {
		server.ended([
			{ player: "p-2", rank: 1, score: 1, details: details.hiderWon },
			{ player: "p-1", rank: 2, score: 0, details: details.oniLost },
		]);
	}
}

describe("runScenario - シナリオの動かし方", () => {
	it("作成・参加・手順（立候補 → 準備移動で退出）を順に動かし、結果を検査して成功にする", async () => {
		const server = new FakeServer();
		server.onEvent = oniLeavesScript;
		const result = await run(server);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
		expect(
			server.log
				.filter(({ message }) => message.type !== "set-name")
				.map(({ player, message }) => `${player}:${message.type}`)
				// 後片付けの退出（別のテストで確かめる）より前の、シナリオの部分。
				.slice(0, 4),
		).toEqual([
			"p-1:create-room",
			"p-2:join-room",
			"p-1:game-event",
			"p-1:leave-room",
		]);
		// 立候補は鬼希望エリアの中央への移動。
		const touch = server.log.find(
			({ message }) => message.type === "game-event",
		);
		expect(touch?.message).toMatchObject({
			payload: { type: "move", x: 0, z: 0 },
		});
	});

	it("フェーズの引き金は、エリアの色まで合うときだけ動く", async () => {
		const server = new FakeServer();
		server.onEvent = (s, player, message) => {
			if (message.type === "game-event") {
				s.phase("oni-selection", "ready");
				s.phase("oni-selection", "counting");
			}
			if (message.type === "leave-room" && player === "p-2") {
				s.ended([{ player: "p-1", rank: 1, score: 0, details: details.void }]);
			}
		};
		const result = await run(server, {
			name: "不成立",
			bots: ["bot-a", "bot-b"],
			steps: [
				{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
				{
					on: { phase: "oni-selection", area: "counting" },
					bot: "bot-b",
					action: { type: "leave" },
				},
			],
			receivers: ["bot-a"],
			rankings: [{ bot: "bot-a", rank: 1, score: 0, details: details.void }],
		});
		expect(result.problems).toEqual([]);
		// シナリオの中で最初に退出するのは、カウント中に抜ける p-2（後片付けの退出はその後）。
		expect(
			server.log.find(({ message }) => message.type === "leave-room")?.player,
		).toBe("p-2");
	});

	it("game-ended が届かなければ、失敗として挙げる", async () => {
		const server = new FakeServer();
		const result = await run(server);
		expect(result.ok).toBe(false);
		expect(result.problems).toContain("bot-b に game-ended が届かない");
	});

	it("退出したボットに game-ended が届いたら、失敗として挙げる", async () => {
		const server = new FakeServer();
		server.onEvent = (s, player, message) => {
			if (message.type === "game-event") s.phase("preparation");
			if (message.type === "leave-room" && player === "p-1") {
				// 誤って、退出した人にも送る。
				const leaver = [...s.players].find(([, id]) => id === "p-1")?.[0];
				leaver?.deliver({
					type: "game-ended",
					gameType: "veryare",
					roomId: "room-1",
					result: { order: "higher-is-better", rankings: [] },
				});
				s.ended([
					{ player: "p-2", rank: 1, score: 1, details: details.hiderWon },
					{ player: "p-1", rank: 2, score: 0, details: details.oniLost },
				]);
			}
		};
		const result = await run(server);
		expect(result.problems).toContain("退出した bot-a に game-ended が届いた");
	});

	it("つながらなければ、失敗として理由を挙げる", async () => {
		const result = await runScenario(scenario, {
			url: "ws://nowhere/ws",
			seed: 1,
			stepTimeoutMs: 200,
			createSocket: () => {
				const socket = new FakeSocket(new FakeServer());
				queueMicrotask(() => socket.emit("error", {}));
				return socket;
			},
		});
		expect(result.ok).toBe(false);
		expect(result.problems[0]).toContain("につながらない");
	});
});

describe("runScenario - 後片付け", () => {
	it("終わったら、まだルームにいるボットは退出してから閉じる（ルームを猶予の間残さない）", async () => {
		const server = new FakeServer();
		server.onEvent = oniLeavesScript;
		await run(server);
		const leaves = server.log
			.filter(({ message }) => message.type === "leave-room")
			.map(({ player }) => player);
		// p-1 は手順で退出済み。後片付けで、p-2 も退出する（p-1 が重ねて送っても害はない）。
		expect(leaves).toContain("p-2");
		expect(server.inRoom.size).toBe(0);
	});
});

describe("seeded - 種から決まる乱数", () => {
	it("同じ種なら同じ並び、違う種なら違う並び", () => {
		const take = (seed: number) => {
			const random = seeded(seed);
			return [random(), random(), random()];
		};
		expect(take(42)).toEqual(take(42));
		expect(take(42)).not.toEqual(take(43));
		for (const value of take(7)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});
