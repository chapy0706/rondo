/**
 * 試験（issue-51）の土台。実際のサーバーにボットをつなぐ操作と、サーバーのプロセスの見本取り。
 * `tools/load.sh` から呼ぶ各試験（limits・load・chaos・garbage・soak）が使う。
 *
 * - 接続先: 引数 --url、環境変数 RONDO_BOTS_URL、既定 ws://localhost:3300/ws の順
 * - サーバーのプロセス: 環境変数 RONDO_SERVER_PID（tools/load.sh が、待ち受けのポートから調べて渡す）。
 *   無ければ、メモリと CPU は測らない
 */

import { execFileSync } from "node:child_process";
import type { ServerMessage } from "@rondo/contracts";
import { Bot } from "../client.ts";
import type { ProcessSample } from "./stats.ts";

export const GAME_TYPE = "veryare";

export const createSocket = (target: string) => new WebSocket(target);

/** 引数 --name 値 を読む。 */
export function option(name: string): string | undefined {
	const args = process.argv.slice(2);
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

/** 接続先。--url（本番での確かめに直接呼ぶとき）、環境変数、既定の順。 */
export const url =
	option("--url") ?? process.env.RONDO_BOTS_URL ?? "ws://localhost:3300/ws";
/** サーバーのプロセス。無ければ、メモリと CPU は測らない（本番に向けたときなど）。 */
export const serverPid = process.env.RONDO_SERVER_PID || null;

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** prefix-1 から prefix-n までの名前で、n 本つなぐ。 */
export async function connectBots(prefix: string, n: number): Promise<Bot[]> {
	const bots: Bot[] = [];
	for (let i = 1; i <= n; i++) {
		bots.push(await Bot.connect(url, `${prefix}-${i}`, createSocket));
	}
	return bots;
}

/** room-joined か error を待つ（作成・参加・復帰の返事）。 */
export function reply(
	bot: Bot,
	since: number,
	timeoutMs = 5_000,
): Promise<ServerMessage> {
	return bot.waitFor(
		(m) =>
			(m.type === "room-joined" || m.type === "error") &&
			bot.received.findIndex((r) => r.message === m) >= since,
		timeoutMs,
		"room-joined か error",
	);
}

/** ルームを作り、返事を返す。 */
export async function create(
	bot: Bot,
	settings?: Readonly<Record<string, number>>,
): Promise<ServerMessage> {
	const since = bot.received.length;
	bot.send(
		settings === undefined
			? { type: "create-room", gameType: GAME_TYPE }
			: { type: "create-room", gameType: GAME_TYPE, settings },
	);
	return reply(bot, since);
}

/** ルームに入り、返事を返す。 */
export async function join(bot: Bot, roomId: string): Promise<ServerMessage> {
	const since = bot.received.length;
	bot.send({ type: "join-room", gameType: GAME_TYPE, roomId });
	return reply(bot, since);
}

/** 待機ルームの (x, z) へ動く報告。 */
export function move(
	bot: Bot,
	roomId: string,
	x: number,
	z: number,
	facing = 0,
) {
	bot.send({
		type: "game-event",
		gameType: GAME_TYPE,
		roomId,
		payload: { type: "move", x, z, facing },
	});
}

/** 入っているルームから出て、閉じる（同時ルーム数の上限に、次の試験のルームを残さないため）。 */
export function leaveAll(bots: readonly Bot[]): void {
	for (const bot of bots) {
		for (const joined of bot.all("room-joined")) {
			bot.send({ type: "leave-room", roomId: joined.roomId });
		}
		bot.close();
	}
}

/** サーバーが生きていて、別の接続とふつうに話せるか（list-rooms に room-list が返るか）。 */
export async function serverHealthy(name = "probe"): Promise<boolean> {
	try {
		const probe = await Bot.connect(url, name, createSocket);
		probe.send({ type: "list-rooms", gameType: GAME_TYPE });
		await probe.waitFor((m) => m.type === "room-list", 5_000, "room-list");
		probe.close();
		return true;
	} catch {
		return false;
	}
}

/** サーバーのプロセスの RSS（KiB）と CPU（%）を、ps で1回だけ読む。読めなければ null。 */
export function sampleServer(): ProcessSample | null {
	if (serverPid === null) return null;
	try {
		const out = execFileSync("ps", ["-o", "rss=,%cpu=", "-p", serverPid], {
			encoding: "utf8",
		}).trim();
		const [rss, cpu] = out.split(/\s+/).map(Number);
		if (rss === undefined || cpu === undefined || Number.isNaN(rss)) {
			return null;
		}
		return { at: Date.now(), rssKb: rss, cpu };
	} catch {
		return null;
	}
}

/** intervalMs ごとに見本を取り続ける。stop で止めて、取った見本を返す。 */
export function startSampling(intervalMs: number): () => ProcessSample[] {
	const samples: ProcessSample[] = [];
	const take = () => {
		const sample = sampleServer();
		if (sample !== null) samples.push(sample);
	};
	take();
	const timer = setInterval(take, intervalMs);
	return () => {
		clearInterval(timer);
		take();
		return samples;
	};
}

/** 確かめの結果1件。 */
export interface Check {
	readonly name: string;
	readonly ok: boolean;
	readonly detail: string;
}

/** 確かめの結果を表で出し、全部通ったかを返す。 */
export function printChecks(title: string, checks: readonly Check[]): boolean {
	console.log(`\n## ${title}\n`);
	console.log("| 確かめ | 結果 | 詳細 |");
	console.log("| --- | --- | --- |");
	for (const check of checks) {
		console.log(
			`| ${check.name} | ${check.ok ? "通過" : "失敗"} | ${check.detail} |`,
		);
	}
	return checks.every((c) => c.ok);
}

/** error の電文なら、その code。 */
export function errorCode(message: ServerMessage): string | null {
	return message.type === "error" ? message.code : null;
}
