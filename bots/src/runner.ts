/**
 * シナリオを1本動かす（issue-49）。
 *
 * 1. 全ボットをつなぐ（session と表示名）
 * 2. 先頭のボットが veryare のルームを作り、残りが順に参加する
 * 3. 手順（steps）を、引き金（全員がそろった直後・フェーズの通知）に合わせて動かす
 * 4. game-ended を待ち、結果と限定配信を検査する
 *
 * ソケットの作り方は外から渡す（本番は Node の WebSocket、テストは偽物）。
 * 乱数の種（seed）は、参加の間隔の揺らぎに使う。失敗したら同じ種で再現できる。
 */

import type {
	ServerMessage,
	VeryareOpenDoorEvent,
	VeryareShootEvent,
} from "@rondo/contracts";
import { Bot, type CreateSocket } from "./client.ts";
import {
	type ScenarioResult,
	checkGameEnded,
	checkTargeted,
} from "./expect.ts";
import {
	type Cell,
	type DoorShotPlan,
	cellOf,
	centerOf,
	findPath,
	pickDoorShot,
} from "./plan.ts";
import { type Action, type Scenario, matchesTrigger } from "./scenario.ts";
import {
	type Point,
	type StageMap,
	readStageNotice,
	spreadSpots,
} from "./stage.ts";

export interface RunOptions {
	readonly url: string;
	readonly createSocket: CreateSocket;
	readonly seed: number;
	/** 1つの電文を待つ上限（ミリ秒）。 */
	readonly stepTimeoutMs?: number;
	/** game-ended を待つ上限（ミリ秒）。フェーズ時間を縮めたサーバーで数秒。 */
	readonly endTimeoutMs?: number;
}

const GAME_TYPE = "veryare";

export async function runScenario(
	scenario: Scenario,
	options: RunOptions,
): Promise<ScenarioResult> {
	const started = Date.now();
	const stepTimeoutMs = options.stepTimeoutMs ?? 5_000;
	const endTimeoutMs = options.endTimeoutMs ?? 30_000;
	const random = seeded(options.seed);
	const bots = new Map<string, Bot>();
	try {
		for (const name of scenario.bots) {
			bots.set(
				name,
				await Bot.connect(
					options.url,
					name,
					options.createSocket,
					stepTimeoutMs,
				),
			);
		}
		const [creatorName, ...joinerNames] = scenario.bots;
		const creator = bots.get(creatorName ?? "");
		if (creator === undefined) throw new Error("ボットがいない");

		creator.send({ type: "create-room", gameType: GAME_TYPE });
		const created = await creator.waitFor(
			(m) => m.type === "room-joined",
			stepTimeoutMs,
			"room-joined（作成）",
		);
		if (created.type !== "room-joined") throw new Error("ルームを作れない");
		const roomId = created.roomId;
		// 手順が使う共有の状態（選んだマス・各ボットのいるマス・確かめの問題）。
		const context: Context = {
			plan: undefined,
			at: new Map(),
			problems: [],
		};
		// ボットの名前から、サーバーが発行したプレイヤー識別子へ（撃つ相手の指定に使う）。
		const idOf = (name: string): string | null =>
			bots.get(name)?.playerId ?? null;

		for (const name of joinerNames) {
			await sleep(Math.floor(random() * 50));
			const bot = bots.get(name) as Bot;
			bot.send({ type: "join-room", gameType: GAME_TYPE, roomId });
			await bot.waitFor(
				(m) => m.type === "room-joined" && m.roomId === roomId,
				stepTimeoutMs,
				"room-joined（参加）",
			);
		}

		// フェーズの通知を引き金にする手順を、各ボットに仕掛ける（1回だけ動く）。
		for (const step of scenario.steps) {
			if (step.on === "joined") continue;
			const trigger = step.on;
			const bot = bots.get(step.bot) as Bot;
			let done = false;
			const off = bot.onMessage((message) => {
				if (done || message.type !== "game-state") return;
				if (!matchesTrigger(trigger, message.payload)) return;
				done = true;
				off();
				later(step.delayMs, () => act(bot, step.action, roomId, idOf, context));
			});
		}
		for (const step of scenario.steps) {
			if (step.on !== "joined") continue;
			const bot = bots.get(step.bot) as Bot;
			later(step.delayMs, () => act(bot, step.action, roomId, idOf, context));
		}

		// 届くべきボット全員に game-ended が届くのを待つ。
		const got = new Map<string, ServerMessage | undefined>();
		await Promise.all(
			scenario.receivers.map(async (name) => {
				const bot = bots.get(name) as Bot;
				try {
					got.set(
						name,
						await bot.waitFor(
							(m) => m.type === "game-ended" && m.roomId === roomId,
							endTimeoutMs,
							"game-ended",
						),
					);
				} catch {
					got.set(name, undefined);
				}
			}),
		);

		const ids = new Map(
			[...bots].map(([name, bot]) => [name, bot.playerId ?? ""] as const),
		);
		const problems = [
			...context.problems,
			...checkGameEnded(scenario, ids, got),
		];
		// 退出したボットには、game-ended が届かないこと（参加者でない接続には送らない）。
		for (const [name, bot] of bots) {
			if (scenario.receivers.includes(name)) continue;
			if (bot.all("game-ended").length > 0) {
				problems.push(`退出した ${name} に game-ended が届いた`);
			}
		}
		if (scenario.targeted === true) {
			problems.push(
				...checkTargeted(
					[...bots].map(([name, bot]) => ({
						name,
						playerId: bot.playerId ?? "",
						messages: bot.received.map((r) => r.message),
					})),
				),
			);
		}
		return result(scenario, started, problems);
	} catch (error) {
		return result(scenario, started, [
			error instanceof Error ? error.message : String(error),
		]);
	} finally {
		// 閉じる前にルームから退出する。切断だけだと再接続猶予（10 秒）の間ルームが残り、
		// 同時ルーム数の上限（3）に、次のシナリオが当たるため。
		for (const bot of bots.values()) {
			for (const joined of bot.all("room-joined")) {
				bot.send({ type: "leave-room", roomId: joined.roomId });
			}
			bot.close();
		}
	}
}

/** 手順のあいだで共有する状態。 */
interface Context {
	/** 壁越し・襖越しの射撃のマス。最初に要るときに、届いたステージの通知から選ぶ。 */
	plan: DoorShotPlan | null | undefined;
	/** 各ボットが歩いて着いたマス（まだ歩いていなければ玄関）。 */
	readonly at: Map<string, Cell>;
	/** 確かめで見つかった問題。 */
	readonly problems: string[];
}

function act(
	bot: Bot,
	action: Action,
	roomId: string,
	idOf: (name: string) => string | null,
	context: Context,
): void {
	switch (action.type) {
		case "touch-area":
			move(bot, roomId, 0, 0);
			break;
		case "move":
			move(bot, roomId, action.x, action.z);
			break;
		case "leave":
			bot.send({ type: "leave-room", roomId });
			break;
		case "stay":
			break;
		case "hide": {
			const spot = hideSpot(bot, action.index);
			if (spot !== null) move(bot, roomId, spot.x, spot.z);
			break;
		}
		case "go": {
			const stage = stageOf(bot);
			const plan = planOf(bot, context);
			if (stage === null || plan === null) break;
			const from = context.at.get(bot.name) ?? cellOf(stage, stage.spawn);
			const path = findPath(stage, from, plan[action.to], action.doors);
			if (path === null) {
				context.problems.push(`${bot.name} が ${action.to} へ歩けない`);
				break;
			}
			// 1マスずつ、マスの中心へ動く（隣のマスへは一直線なので、移動の規則でそのまま着く）。
			for (const cell of path) {
				const p = centerOf(stage, cell);
				move(bot, roomId, p.x, p.z);
			}
			context.at.set(bot.name, plan[action.to]);
			break;
		}
		case "open-door": {
			const plan = planOf(bot, context);
			if (plan === null) break;
			const payload: VeryareOpenDoorEvent = {
				type: "open-door",
				door: plan.door,
			};
			bot.send({ type: "game-event", gameType: GAME_TYPE, roomId, payload });
			break;
		}
		case "expect-hiding": {
			const id = idOf(action.target);
			const hiding = latestHiding(bot);
			const actual = id !== null && hiding !== null && hiding.includes(id);
			if (actual !== action.hiding) {
				context.problems.push(
					`${action.check}: ${action.target} は${action.hiding ? "まだ隠れているはず" : "見つかっているはず"}（隠れている一覧: ${hiding?.join(", ") ?? "届いていない"}）`,
				);
			}
			break;
		}
		case "shoot": {
			const payload: VeryareShootEvent = {
				type: "shoot",
				target: action.target === null ? null : idOf(action.target),
			};
			bot.send({ type: "game-event", gameType: GAME_TYPE, roomId, payload });
			break;
		}
	}
}

/** ボットに届いたステージの通知。無ければ null。 */
function stageOf(bot: Bot): StageMap | null {
	for (const { message } of bot.received) {
		if (message.type !== "game-state" && message.type !== "game-state-to")
			continue;
		const stage = readStageNotice(message.payload);
		if (stage !== null) return stage;
	}
	return null;
}

/** 壁越し・襖越しの射撃のマス（シナリオで1回だけ選ぶ）。選べなければ問題にする。 */
function planOf(bot: Bot, context: Context): DoorShotPlan | null {
	if (context.plan !== undefined) return context.plan;
	const stage = stageOf(bot);
	if (stage === null) return null;
	context.plan = pickDoorShot(stage);
	if (context.plan === null) {
		context.problems.push(
			"壁越し・襖越しに撃つためのマスが、このステージに見つからない",
		);
	}
	return context.plan;
}

/** いちばん新しい、まだ隠れている一覧。届いていなければ null。 */
function latestHiding(bot: Bot): readonly string[] | null {
	let latest: readonly string[] | null = null;
	for (const { message } of bot.received) {
		if (message.type !== "game-state") continue;
		const payload = message.payload as { type?: unknown; playerIds?: unknown };
		if (payload.type === "hiding" && Array.isArray(payload.playerIds)) {
			latest = payload.playerIds.filter(
				(id): id is string => typeof id === "string",
			);
		}
	}
	return latest;
}

/** 隠れ場所の距離の上限（メートル）。鬼の射程 8 m（issue-27）の内側に収める。 */
export const HIDE_MAX_DISTANCE = 7;

/** ボットに届いたステージの通知から、index 番目の隠れ場所を選ぶ。通知が無ければ null。 */
function hideSpot(bot: Bot, index: number): Point | null {
	for (const { message } of bot.received) {
		if (message.type !== "game-state" && message.type !== "game-state-to")
			continue;
		const stage = readStageNotice(message.payload);
		if (stage !== null) {
			return spreadSpots(stage, index + 1, HIDE_MAX_DISTANCE)[index] ?? null;
		}
	}
	return null;
}

/** delayMs だけ待ってから動かす（0 か無しなら、すぐ）。 */
function later(delayMs: number | undefined, run: () => void): void {
	if (delayMs === undefined || delayMs <= 0) {
		run();
		return;
	}
	setTimeout(run, delayMs);
}

function move(bot: Bot, roomId: string, x: number, z: number): void {
	bot.send({
		type: "game-event",
		gameType: GAME_TYPE,
		roomId,
		payload: { type: "move", x, z },
	});
}

function result(
	scenario: Scenario,
	started: number,
	problems: readonly string[],
): ScenarioResult {
	return {
		name: scenario.name,
		ok: problems.length === 0,
		ms: Date.now() - started,
		problems,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 種から決まる乱数（mulberry32）。0 以上 1 未満。 */
export function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
