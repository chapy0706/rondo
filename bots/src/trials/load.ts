/**
 * 同時負荷の試験（issue-51）。3ルーム × 5人（15接続）を同時に動かし、次を測る。
 *
 * 1. 待機ルームの同期（issue-59 / ADR 0044）: 全員が待機ルームで 50 ms ごとに歩き続け（向きも変わる）、
 *    ときどき待機ポーズを変える。1接続が受け取るメンバーの通知の数と大きさ、全電文のバイト数
 * 2. フェーズ通知の遅れ: 歩き続けている間に、各ルームの作った人が中央の円に触れ、カウントの開始の
 *    通知が、そのルームの5人に届くまでの時間（同じ機械の時計で測る。送ってから届くまで）
 * 3. サーバーのメモリと CPU（ps で 1 秒ごと）
 *
 *   node src/trials/load.ts [--seconds 20]     （tools/load.sh load から呼ぶ）
 */

import type { ServerMessage } from "@rondo/contracts";
import type { Bot } from "../client.ts";
import {
	type Check,
	GAME_TYPE,
	connectBots,
	create,
	join,
	leaveAll,
	move,
	option,
	printChecks,
	serverHealthy,
	sleep,
	startSampling,
} from "./harness.ts";
import { markdownTable, memorySummary, perSecond, summarize } from "./stats.ts";

const seconds = Number(option("--seconds") ?? 20);
const ROOMS = 3;
const PER_ROOM = 5;
const STEP_MS = 50;
const POSES = ["femaleDance", "maleSitting1", "femaleStanding2", "maleCrouch"];
const encoder = new TextEncoder();

const isMembers = (m: ServerMessage) =>
	(m.type === "game-state" || m.type === "game-state-to") &&
	(m.payload as { type?: unknown }).type === "members";

const everyone: Bot[] = [];
const checks: Check[] = [];
const stopSampling = startSampling(1_000);
const started = Date.now();

try {
	// 3ルームを作り、各ルームに4人ずつ入る。
	const rooms: { id: string; bots: Bot[] }[] = [];
	for (let r = 1; r <= ROOMS; r++) {
		const [creator, ...joiners] = await connectBots(`load-r${r}`, PER_ROOM);
		if (creator === undefined) throw new Error("ボットがいない");
		everyone.push(creator, ...joiners);
		const made = await create(creator);
		if (made.type !== "room-joined") {
			throw new Error(`ルーム ${r} を作れない: ${JSON.stringify(made)}`);
		}
		for (const bot of joiners) {
			const joined = await join(bot, made.roomId);
			if (joined.type !== "room-joined") {
				throw new Error(`ルーム ${r} に入れない: ${JSON.stringify(joined)}`);
			}
		}
		rooms.push({ id: made.roomId, bots: [creator, ...joiners] });
	}
	console.log(
		`[load] ${ROOMS} ルーム × ${PER_ROOM} 人がそろった。${seconds} 秒、歩き続ける`,
	);

	// 全員が、半径 2.5 m の輪の上を回り続ける（鬼希望エリアには入らない）。ときどき待機ポーズを変える。
	let walking = true;
	const walkers = new Set<Bot>(everyone);
	const walk = (async () => {
		let tick = 0;
		while (walking) {
			const t = tick * STEP_MS;
			for (const [r, room] of rooms.entries()) {
				for (const [i, bot] of room.bots.entries()) {
					if (!walkers.has(bot)) continue;
					const angle = i * 1.2566 + r + (t / 1000) * 1.5;
					move(
						bot,
						room.id,
						2.5 * Math.cos(angle),
						2.5 * Math.sin(angle),
						angle + Math.PI / 2,
					);
					if (tick % 60 === i * 7) {
						bot.send({
							type: "game-event",
							gameType: GAME_TYPE,
							roomId: room.id,
							payload: {
								type: "waiting-pose",
								pose: POSES[(tick + i) % POSES.length],
							},
						});
					}
				}
			}
			tick++;
			await sleep(STEP_MS);
		}
	})();

	// 最初の 1 秒は除いて、測る窓を取る。
	await sleep(1_000);
	const windowStart = Date.now();
	const bytesStart = new Map(everyone.map((b) => [b, b.bytesReceived]));
	await sleep(Math.max(1, seconds - 1) * 1_000);
	const windowEnd = Date.now();
	const windowMs = windowEnd - windowStart;

	const perBot = everyone.map((bot) => {
		const inWindow = bot.received.filter(
			(r) => r.at >= windowStart && r.at < windowEnd,
		);
		const members = inWindow.filter((r) => isMembers(r.message));
		return {
			members: members.length,
			sizes: members.map(
				(r) => encoder.encode(JSON.stringify(r.message)).length,
			),
			bytes: bot.bytesReceived - (bytesStart.get(bot) ?? 0),
		};
	});
	const membersRate = summarize(
		perBot.map((b) => perSecond(b.members, windowMs)),
	);
	const sizes = summarize(perBot.flatMap((b) => b.sizes));
	const bytesRate = summarize(perBot.map((b) => perSecond(b.bytes, windowMs)));

	// 歩き続けたまま、各ルームの作った人が、同時に中央の円に触れる。カウントの開始が届くまでの時間。
	const latencies: number[] = [];
	const spreads: number[] = [];
	await Promise.all(
		rooms.map(async (room) => {
			const [creator] = room.bots;
			if (creator === undefined) return;
			walkers.delete(creator);
			await sleep(200);
			const sentAt = Date.now();
			move(creator, room.id, 0, 0);
			const arrivals = await Promise.all(
				room.bots.map(async (bot) => {
					const notice = await bot.waitFor(
						(m) =>
							m.type === "game-state" &&
							(m.payload as { type?: unknown; area?: unknown }).type ===
								"phase" &&
							(m.payload as { area?: unknown }).area === "counting",
						5_000,
						"カウントの開始",
					);
					const at = bot.received.find((r) => r.message === notice)?.at ?? 0;
					return at - sentAt;
				}),
			);
			latencies.push(...arrivals);
			spreads.push(Math.max(...arrivals) - Math.min(...arrivals));
		}),
	);
	walking = false;
	await walk;

	const latency = summarize(latencies);
	const spread = summarize(spreads);
	const memory = memorySummary(stopSampling());
	const fmt = (v: number | undefined, digits = 1) =>
		v === undefined ? "-" : v.toFixed(digits);

	console.log(
		`\n## 同時負荷（${ROOMS} ルーム × ${PER_ROOM} 人、歩き続けた ${(windowMs / 1000).toFixed(1)} 秒）\n`,
	);
	console.log(
		markdownTable(
			["項目", "最小", "中央", "95%", "最大"],
			[
				[
					"1接続が受け取るメンバーの通知（通/秒）",
					fmt(membersRate?.min),
					fmt(membersRate?.p50),
					fmt(membersRate?.p95),
					fmt(membersRate?.max),
				],
				[
					"メンバーの通知1通の大きさ（バイト。JSON を取り直した大きさ）",
					fmt(sizes?.min, 0),
					fmt(sizes?.p50, 0),
					fmt(sizes?.p95, 0),
					fmt(sizes?.max, 0),
				],
				[
					"1接続が受け取る全電文（バイト/秒）",
					fmt(bytesRate?.min, 0),
					fmt(bytesRate?.p50, 0),
					fmt(bytesRate?.p95, 0),
					fmt(bytesRate?.max, 0),
				],
				[
					"カウントの開始が届くまで（ms。送ってから）",
					fmt(latency?.min, 0),
					fmt(latency?.p50, 0),
					fmt(latency?.p95, 0),
					fmt(latency?.max, 0),
				],
				[
					"同じルームの5人に届く時刻の差（ms）",
					fmt(spread?.min, 0),
					fmt(spread?.p50, 0),
					fmt(spread?.p95, 0),
					fmt(spread?.max, 0),
				],
			],
		),
	);
	console.log("");
	console.log(
		markdownTable(
			["サーバー", "値"],
			memory === null
				? [["メモリ・CPU", "測れない（RONDO_SERVER_PID が無い）"]]
				: [
						["RSS の始め（MiB）", fmt(memory.startMb)],
						["RSS の最大（MiB）", fmt(memory.maxMb)],
						["RSS の終わり（MiB）", fmt(memory.endMb)],
						["CPU の平均（%）", fmt(memory.cpuMean)],
						["CPU の最大（%）", fmt(memory.cpuMax)],
					],
		),
	);
	const roomRate = (membersRate?.p50 ?? 0) * PER_ROOM;
	console.log(
		`\n1ルームが送るメンバーの通知: 約 ${roomRate.toFixed(1)} 通/秒（中央の値 × 5 宛先）`,
	);
	checks.push({
		name: "1ルームが送るメンバーの通知は 50 通/秒以下",
		ok: roomRate <= 50,
		detail: `約 ${roomRate.toFixed(1)} 通/秒`,
	});
	checks.push({
		name: "カウントの開始が、15接続すべてに届いた",
		ok: latencies.length === ROOMS * PER_ROOM,
		detail: `${latencies.length} 接続`,
	});
	checks.push({
		name: "歩き続けている間も、カウントの開始は 500 ms 以内に届く（95%）",
		ok: (latency?.p95 ?? Number.POSITIVE_INFINITY) <= 500,
		detail: `95% ${fmt(latency?.p95, 0)} ms`,
	});
} catch (error) {
	stopSampling();
	checks.push({
		name: "試験の途中",
		ok: false,
		detail: error instanceof Error ? error.message : String(error),
	});
} finally {
	leaveAll(everyone);
}

await sleep(300);
checks.push({
	name: "試験の後も、サーバーは別の接続とふつうに話せる",
	ok: await serverHealthy(),
	detail: `全体 ${((Date.now() - started) / 1000).toFixed(1)} 秒`,
});
process.exit(printChecks("同時負荷の試験", checks) ? 0 : 1);
