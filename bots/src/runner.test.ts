import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import stageFixture from "../../packages/contracts/src/fixtures/veryare-stage.json";
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

describe("runScenario - 撃つ（issue-27）", () => {
	it("撃つ相手はボットの名前で書き、サーバーの識別子に直して、間を空けて送る", async () => {
		const server = new FakeServer();
		server.onEvent = (s, player, message) => {
			if (message.type !== "game-event") return;
			const payload = message.payload as { type: string; target?: unknown };
			if (payload.type === "move") s.phase("exploration");
			if (payload.type === "shoot" && payload.target === "p-3") {
				s.ended([
					{ player: "p-1", rank: 1, score: 1, details: details.oniWon },
					{ player: "p-2", rank: 2, score: 0, details: details.hiderLost },
					{ player: "p-3", rank: 2, score: 0, details: details.hiderLost },
				]);
			}
		};
		const started = Date.now();
		const result = await run(server, {
			name: "全員発見",
			bots: ["bot-a", "bot-b", "bot-c"],
			steps: [
				{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
				{
					on: { phase: "exploration" },
					bot: "bot-a",
					action: { type: "shoot", target: null },
				},
				{
					on: { phase: "exploration" },
					bot: "bot-a",
					action: { type: "shoot", target: "bot-b" },
					delayMs: 60,
				},
				{
					on: { phase: "exploration" },
					bot: "bot-a",
					action: { type: "shoot", target: "bot-c" },
					delayMs: 120,
				},
			],
			receivers: ["bot-a", "bot-b", "bot-c"],
			rankings: [
				{ bot: "bot-a", rank: 1, score: 1, details: details.oniWon },
				{ bot: "bot-b", rank: 2, score: 0, details: details.hiderLost },
				{ bot: "bot-c", rank: 2, score: 0, details: details.hiderLost },
			],
		});
		expect(result.problems).toEqual([]);
		const shots = server.log
			.filter(({ message }) => message.type === "game-event")
			.map(({ player, message }) =>
				message.type === "game-event" ? [player, message.payload] : [],
			)
			.filter(([, payload]) => (payload as { type: string }).type === "shoot");
		expect(shots).toEqual([
			["p-1", { type: "shoot", target: null }],
			["p-1", { type: "shoot", target: "p-2" }],
			["p-1", { type: "shoot", target: "p-3" }],
		]);
		expect(Date.now() - started).toBeGreaterThanOrEqual(120);
	});
});

describe("runScenario - 隠れる（issue-29a）", () => {
	it("届いたステージの通知から、別々の場所を選んで動く", async () => {
		const server = new FakeServer();
		server.onEvent = (s, player, message) => {
			if (message.type === "create-room" || message.type === "join-room") {
				// ステージの通知（共有の見本の小さな屋敷）を、本人へ送る。
				const socket = [...s.players].find(([, id]) => id === player)?.[0];
				socket?.deliver({
					type: "game-state-to",
					gameType: "veryare",
					roomId: "room-1",
					to: player,
					payload: stageFixture.valid[0],
				});
			}
			if (message.type !== "game-event") return;
			const payload = message.payload as { type: string; x?: number };
			if (payload.type === "move" && player === "p-1") s.phase("preparation");
			if (payload.type === "move" && player === "p-3") {
				s.ended([
					{ player: "p-2", rank: 1, score: 1, details: details.hiderWon },
					{ player: "p-3", rank: 1, score: 1, details: details.hiderWon },
					{ player: "p-1", rank: 2, score: 0, details: details.oniLost },
				]);
			}
		};
		const result = await run(server, {
			name: "散らばる",
			bots: ["bot-a", "bot-b", "bot-c"],
			steps: [
				{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
				{
					on: { phase: "preparation" },
					bot: "bot-b",
					action: { type: "hide", index: 0 },
				},
				{
					on: { phase: "preparation" },
					bot: "bot-c",
					action: { type: "hide", index: 1 },
				},
			],
			receivers: ["bot-a", "bot-b", "bot-c"],
			rankings: [
				{ bot: "bot-b", rank: 1, score: 1, details: details.hiderWon },
				{ bot: "bot-c", rank: 1, score: 1, details: details.hiderWon },
				{ bot: "bot-a", rank: 2, score: 0, details: details.oniLost },
			],
		});
		expect(result.problems).toEqual([]);
		const moves = server.log
			.filter(
				({ player, message }) =>
					player !== "p-1" && message.type === "game-event",
			)
			.map(({ player, message }) =>
				message.type === "game-event" ? [player, message.payload] : [],
			);
		expect(moves).toEqual([
			["p-2", { type: "move", x: 0.5, z: 3.5 }],
			["p-3", { type: "move", x: 1.5, z: 4.5 }],
		]);
	});
});

describe("runScenario - 壁越し・襖越しの射撃（issue-29b）", () => {
	const scenario: Scenario = {
		name: "襖",
		bots: ["bot-a", "bot-b", "bot-c"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{
				on: { phase: "preparation" },
				bot: "bot-b",
				action: { type: "go", to: "r", doors: "open" },
			},
			{
				on: { phase: "preparation" },
				bot: "bot-c",
				action: { type: "go", to: "s", doors: "open" },
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "go", to: "w", doors: "closed" },
				delayMs: 10,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "shoot", target: "bot-b" },
				delayMs: 30,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-hiding",
					check: "壁越しの射撃は外れる",
					target: "bot-b",
					hiding: true,
				},
				delayMs: 60,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "go", to: "c", doors: "closed" },
				delayMs: 70,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "open-door" },
				delayMs: 80,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: { type: "shoot", target: "bot-c" },
				delayMs: 90,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-hiding",
					check: "開けた襖越しの射撃は当たる",
					target: "bot-c",
					hiding: false,
				},
				delayMs: 120,
			},
		],
		receivers: ["bot-a", "bot-b", "bot-c"],
		rankings: [
			{ bot: "bot-b", rank: 1, score: 1, details: details.hiderWon },
			{ bot: "bot-c", rank: 1, score: 1, details: details.hiderWonFound },
			{ bot: "bot-a", rank: 2, score: 0, details: details.oniLost },
		],
	};

	/** 小さな屋敷で動く偽物のサーバー。wallHits なら、壁越しの射撃を誤って当てる。 */
	function doorServer(wallHits: boolean): FakeServer {
		const server = new FakeServer();
		let hiding = ["p-2", "p-3"];
		const sendHiding = (s: FakeServer) =>
			s.broadcast({
				type: "game-state",
				gameType: "veryare",
				roomId: "room-1",
				payload: { type: "hiding", playerIds: hiding },
			});
		server.onEvent = (s, player, message) => {
			if (message.type === "create-room" || message.type === "join-room") {
				const socket = [...s.players].find(([, id]) => id === player)?.[0];
				socket?.deliver({
					type: "game-state-to",
					gameType: "veryare",
					roomId: "room-1",
					to: player,
					payload: stageFixture.valid[0],
				});
			}
			if (message.type !== "game-event") return;
			const payload = message.payload as {
				type: string;
				x?: number;
				z?: number;
				target?: string;
			};
			if (payload.type === "move" && player === "p-1" && payload.x === 0) {
				s.phase("preparation");
				sendHiding(s);
			}
			// C が s（部屋 A の襖の内側 (2.5, 1.5)）に着いたら、探索へ。
			if (
				payload.type === "move" &&
				player === "p-3" &&
				payload.x === 2.5 &&
				payload.z === 1.5
			) {
				s.phase("exploration");
			}
			if (payload.type === "shoot") {
				const hit =
					(payload.target === "p-2" && wallHits) ||
					(payload.target === "p-3" && opened);
				if (hit) {
					hiding = hiding.filter((id) => id !== payload.target);
					sendHiding(s);
				}
				if (payload.target === "p-3") {
					setTimeout(
						() =>
							s.ended([
								{ player: "p-2", rank: 1, score: 1, details: details.hiderWon },
								{
									player: "p-3",
									rank: 1,
									score: 1,
									details: details.hiderWonFound,
								},
								{ player: "p-1", rank: 2, score: 0, details: details.oniLost },
							]),
						60,
					);
				}
			}
			if (payload.type === "open-door") opened = true;
		};
		let opened = false;
		return server;
	}

	it("決めたマスへ歩き、壁越しに撃ち、襖の前へ移って襖を開けて撃つ。確かめが通る", async () => {
		const server = doorServer(false);
		const result = await run(server, scenario);
		expect(result.problems).toEqual([]);
		const events = server.log
			.filter(({ message }) => message.type === "game-event")
			.map(({ player, message }) =>
				message.type === "game-event" ? [player, message.payload] : [],
			);
		const last = (who: string) =>
			events
				.filter(
					([p, payload]) =>
						p === who && (payload as { type: string }).type === "move",
				)
				.at(-1)?.[1];
		// B は r (2,0)、C は s (2,1) の中心に着く。
		expect(last("p-2")).toEqual({ type: "move", x: 2.5, z: 0.5 });
		expect(last("p-3")).toEqual({ type: "move", x: 2.5, z: 1.5 });
		// 鬼は w (1,0) で B を撃ち、c (1,1) へ移って、襖 (1,1)-(2,1) を開けて C を撃つ。
		const oni = events
			.filter(([p]) => p === "p-1")
			.map(([, payload]) => payload as { type: string });
		const kinds = oni.map((payload) => payload.type);
		const shootB = kinds.indexOf("shoot");
		expect(oni[shootB - 1]).toEqual({ type: "move", x: 1.5, z: 0.5 });
		expect(oni[shootB]).toEqual({ type: "shoot", target: "p-2" });
		const open = kinds.indexOf("open-door");
		expect(oni[open - 1]).toEqual({ type: "move", x: 1.5, z: 1.5 });
		expect(oni[open]).toEqual({
			type: "open-door",
			door: { a: { x: 1, z: 1 }, b: { x: 2, z: 1 } },
		});
		expect(oni[open + 1]).toEqual({ type: "shoot", target: "p-3" });
	});

	it("確かめが落ちたら、確かめの名前を問題に出す", async () => {
		const result = await run(doorServer(true), scenario);
		expect(result.ok).toBe(false);
		expect(result.problems.join(" / ")).toContain("壁越しの射撃は外れる");
		expect(result.problems.join(" / ")).not.toContain(
			"開けた襖越しの射撃は当たる",
		);
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

describe("runScenario - ペイントの確定と一括配信（issue-25）", () => {
	const scenario: Scenario = {
		name: "ペイント",
		bots: ["bot-a", "bot-b"],
		steps: [
			{ on: "joined", bot: "bot-a", action: { type: "touch-area" } },
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "paint", color: "#a07850" },
			},
			{
				on: { phase: "painting" },
				bot: "bot-b",
				action: { type: "paint", color: "#6b5440" },
				delayMs: 10,
			},
			{
				on: { phase: "exploration" },
				bot: "bot-a",
				action: {
					type: "expect-paint",
					check: "最初のペイントだけが届く",
					target: "bot-b",
					color: "#a07850",
				},
				delayMs: 20,
			},
		],
		receivers: ["bot-a", "bot-b"],
		rankings: [
			{ bot: "bot-b", rank: 1, score: 1, details: details.hiderWon },
			{ bot: "bot-a", rank: 2, score: 0, details: details.oniLost },
		],
	};

	/** keepLast なら、最後のペイントを（誤って）一括配信に載せる偽物のサーバー。 */
	function paintServer(keepLast: boolean): FakeServer {
		const server = new FakeServer();
		const paints: unknown[] = [];
		server.onEvent = (s, player, message) => {
			if (message.type !== "game-event") return;
			const payload = message.payload as {
				type: string;
				x?: number;
				paint?: unknown;
			};
			if (payload.type === "move" && player === "p-1" && payload.x === 0) {
				s.phase("painting");
			}
			if (payload.type === "paint" && player === "p-2") {
				paints.push(payload.paint);
				if (paints.length < 2) return;
				s.phase("exploration");
				s.broadcast({
					type: "game-state",
					gameType: "veryare",
					roomId: "room-1",
					payload: {
						type: "hiders",
						hiders: [
							{
								playerId: "p-2",
								x: 0,
								z: 0,
								facing: null,
								pose: null,
								paint: keepLast ? paints[1] : paints[0],
							},
						],
					},
				});
				setTimeout(
					() =>
						s.ended([
							{ player: "p-2", rank: 1, score: 1, details: details.hiderWon },
							{ player: "p-1", rank: 2, score: 0, details: details.oniLost },
						]),
					60,
				);
			}
		};
		return server;
	}

	it("ペイントフェーズに塗る（契約の VeryarePaintEvent）。探索の開始に届いたペイントを確かめる", async () => {
		const server = paintServer(false);
		const result = await run(server, scenario);
		expect(result.problems).toEqual([]);
		const sent = server.log.flatMap(({ player, message }) =>
			message.type === "game-event" &&
			(message.payload as { type?: string }).type === "paint"
				? [[player, message.payload]]
				: [],
		);
		expect(sent).toEqual([
			[
				"p-2",
				{
					type: "paint",
					paint: {
						kind: "strokes",
						strokes: [
							{
								part: "torso",
								color: "#a07850",
								size: 0.04,
								points: [{ u: 0.25, v: 0.5 }],
							},
						],
					},
				},
			],
			["p-2", expect.objectContaining({ type: "paint" })],
		]);
	});

	it("違うペイントが届いたら、確かめの名前が問題に出る", async () => {
		const result = await run(paintServer(true), scenario);
		expect(result.problems.join("\n")).toContain("最初のペイントだけが届く");
	});
});
