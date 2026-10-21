/**
 * 観戦ルームの試験（issue-67）。ボットの観戦者と、人間の対戦への影響を測る。
 *
 * 1. 人間の 3 ルーム × 5 人（15 接続）が、待機ルームで 50 ms ごとに歩き続ける（load.ts と同じ）
 * 2. 別の利用者の list-rooms の往復の時間を、観戦ルームを作る前に測る（比べる元）
 * 3. 観戦ルーム（隠れ CPU 4 体）を作り、観戦者 20 人（上限）が入る。往復の時間を、もう一度測る
 * 4. 歩き続けたまま、各ルームの作った人が中央の円に触れ、カウントの開始が 5 人に届くまでの時間を測る
 * 5. 観戦ルームが、2 試合目の始まりを過ぎるまで待ち、観戦者が受け取った観戦用の通知を確かめる
 *    （全員の位置・色・ポーズ・間隔、次の試合でも受け取り続ける / spectate.ts）
 *
 *   node src/trials/spectate.ts [--seconds 20]     （tools/load.sh spectate から呼ぶ）
 *
 * サーバーは、tools/load.sh が RONDO_SPECTATE_DEV=1 で起動する（観戦ルームを受け付ける）。
 */

import type { ServerMessage } from "@rondo/contracts";
import type { Bot } from "../client.ts";
import { checkSpectateStream } from "../spectate.ts";
import { type StageMap, readStageNotice } from "../stage.ts";
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
const SPECTATORS = 20;
const HIDER_CPUS = 4;
const STEP_MS = 50;
const TRIPS = 30;
/** 観戦者 1 人が受け取る観戦用の通知の上限（通/秒。100 ms ごとに 1 通）。 */
const MAX_NOTICES_PER_SECOND = 10;
const encoder = new TextEncoder();

const everyone: Bot[] = [];
const checks: Check[] = [];
const stopSampling = startSampling(1_000);
const started = Date.now();

const fmt = (v: number | undefined, digits = 1) =>
	v === undefined ? "-" : v.toFixed(digits);

/** probe の list-rooms の往復時間（ms）。届かなければ null。 */
async function roundTrip(probe: Bot): Promise<number | null> {
	const since = probe.received.length;
	const sentAt = Date.now();
	probe.send({ type: "list-rooms", gameType: GAME_TYPE });
	try {
		const reply = await probe.waitFor(
			(m) =>
				m.type === "room-list" &&
				probe.received.findIndex((r) => r.message === m) >= since,
			5_000,
			"room-list",
		);
		return (
			(probe.received.find((r) => r.message === reply)?.at ?? sentAt) - sentAt
		);
	} catch {
		return null;
	}
}

async function roundTrips(probe: Bot): Promise<number[]> {
	const out: number[] = [];
	for (let i = 0; i < TRIPS; i++) {
		const trip = await roundTrip(probe);
		if (trip !== null) out.push(trip);
		await sleep(50);
	}
	return out;
}

const isSpectate = (m: ServerMessage) =>
	(m.type === "game-state" || m.type === "game-state-to") &&
	(m.payload as { type?: unknown }).type === "spectate";

try {
	// 1. 人間の 3 ルーム × 5 人。
	const rooms: { id: string; bots: Bot[] }[] = [];
	for (let r = 1; r <= ROOMS; r++) {
		const [creator, ...joiners] = await connectBots(`spec-r${r}`, PER_ROOM);
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
						angle,
					);
				}
			}
			tick++;
			await sleep(STEP_MS);
		}
	})();
	const [probe] = await connectBots("spec-probe", 1);
	if (probe === undefined) throw new Error("ボットがいない");
	everyone.push(probe);
	await sleep(1_000);

	// 2. 観戦ルームの前の往復。
	const before = await roundTrips(probe);

	// 3. 観戦ルームと観戦者 20 人（作った人も観戦者）。
	const spectators = await connectBots("spec-watch", SPECTATORS);
	everyone.push(...spectators);
	const [creator, ...watchers] = spectators;
	if (creator === undefined) throw new Error("ボットがいない");
	const made = await create(creator, { spectate: 1, hiderCpus: HIDER_CPUS });
	if (made.type !== "room-joined") {
		throw new Error(
			`観戦ルームを作れない（RONDO_SPECTATE_DEV=1 で起動したか）: ${JSON.stringify(made)}`,
		);
	}
	const spectateRoom = made.roomId;
	const players = made.players.map((p) => p.playerId);
	for (const bot of watchers) {
		const joined = await join(bot, spectateRoom);
		if (joined.type !== "room-joined") {
			throw new Error(`観戦ルームに入れない: ${JSON.stringify(joined)}`);
		}
	}
	console.log(
		`[spectate] 人間の ${ROOMS} ルーム × ${PER_ROOM} 人と、観戦ルーム（観戦者 ${SPECTATORS} 人）がそろった`,
	);
	await sleep(1_000);
	const windowStart = Date.now();
	const during = await roundTrips(probe);
	await sleep(Math.max(1, seconds - 2) * 1_000);
	const windowEnd = Date.now();

	// 4. カウントの開始が届くまで（観戦ルームが動いている間）。
	const latencies: number[] = [];
	await Promise.all(
		rooms.map(async (room) => {
			const [first] = room.bots;
			if (first === undefined) return;
			walkers.delete(first);
			await sleep(200);
			const sentAt = Date.now();
			move(first, room.id, 0, 0);
			const arrivals = await Promise.all(
				room.bots.map(async (bot) => {
					const notice = await bot.waitFor(
						(m) =>
							m.type === "game-state" &&
							(m.payload as { type?: unknown }).type === "phase" &&
							(m.payload as { area?: unknown }).area === "counting",
						5_000,
						"カウントの開始",
					);
					return (
						(bot.received.find((r) => r.message === notice)?.at ?? 0) - sentAt
					);
				}),
			);
			latencies.push(...arrivals);
		}),
	);
	walking = false;
	await walk;

	// 5. 観戦ルームで、次の試合が 2 回始まる（3 試合目に入る）まで待つ（作った人が受け取る game-started）。
	const nextGames = () =>
		creator.all("game-started").filter((g) => g.roomId === spectateRoom).length;
	const waitUntil = Date.now() + 120_000;
	while (nextGames() < 2) {
		if (Date.now() > waitUntil) {
			throw new Error(
				`観戦ルームの次の試合が 2 回始まらない（${nextGames()} 回）`,
			);
		}
		await sleep(200);
	}
	await sleep(1_500);

	// 観戦者ごとに、受け取った観戦用の通知を確かめる。ステージは試合ごとに届く（stage の通知）。
	const results = spectators.map((bot) => {
		const mine = bot.received.filter(
			(r) =>
				(r.message.type === "game-started" &&
					r.message.roomId === spectateRoom) ||
				((r.message.type === "game-state" ||
					r.message.type === "game-state-to") &&
					r.message.roomId === spectateRoom),
		);
		const stages: (StageMap | null)[] = [];
		let game = 0;
		for (const { message } of mine) {
			if (message.type === "game-started") game++;
			if (message.type === "game-state" || message.type === "game-state-to") {
				const map = readStageNotice(message.payload);
				if (map !== null) stages[game] = map;
			}
		}
		const result = checkSpectateStream(mine, {
			players,
			hiderCpus: HIDER_CPUS,
			stageOf: (g) => stages[g] ?? null,
		});
		const inWindow = bot.received.filter(
			(r) => r.at >= windowStart && r.at < windowEnd && isSpectate(r.message),
		);
		return {
			result,
			rate: perSecond(inWindow.length, windowEnd - windowStart),
			sizes: inWindow.map(
				(r) => encoder.encode(JSON.stringify(r.message)).length,
			),
		};
	});

	const beforeTrips = summarize(before);
	const duringTrips = summarize(during);
	const latency = summarize(latencies);
	const rate = summarize(results.map((r) => r.rate));
	const sizes = summarize(results.flatMap((r) => r.sizes));
	const gaps = summarize(results.flatMap((r) => r.result.gapsMs));
	const memory = memorySummary(stopSampling());
	const roomRate = (rate?.p50 ?? 0) * SPECTATORS;

	console.log(
		`\n## 観戦ルーム（観戦者 ${SPECTATORS} 人、隠れ CPU ${HIDER_CPUS} 体）と人間の ${ROOMS} ルーム × ${PER_ROOM} 人\n`,
	);
	console.log(
		markdownTable(
			["項目", "最小", "中央", "95%", "最大"],
			[
				[
					"往復の時間・観戦ルームの前（ms）",
					fmt(beforeTrips?.min, 0),
					fmt(beforeTrips?.p50, 0),
					fmt(beforeTrips?.p95, 0),
					fmt(beforeTrips?.max, 0),
				],
				[
					"往復の時間・観戦ルームと同時（ms）",
					fmt(duringTrips?.min, 0),
					fmt(duringTrips?.p50, 0),
					fmt(duringTrips?.p95, 0),
					fmt(duringTrips?.max, 0),
				],
				[
					"カウントの開始が届くまで（ms）",
					fmt(latency?.min, 0),
					fmt(latency?.p50, 0),
					fmt(latency?.p95, 0),
					fmt(latency?.max, 0),
				],
				[
					"観戦者 1 人が受け取る観戦用の通知（通/秒）",
					fmt(rate?.min),
					fmt(rate?.p50),
					fmt(rate?.p95),
					fmt(rate?.max),
				],
				[
					"観戦用の通知 1 通の大きさ（バイト）",
					fmt(sizes?.min, 0),
					fmt(sizes?.p50, 0),
					fmt(sizes?.p95, 0),
					fmt(sizes?.max, 0),
				],
				[
					"観戦用の通知の間隔（ms）",
					fmt(gaps?.min, 0),
					fmt(gaps?.p50, 0),
					fmt(gaps?.p95, 0),
					fmt(gaps?.max, 0),
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
	console.log(
		`\n観戦ルームが送る観戦用の通知: 約 ${roomRate.toFixed(1)} 通/秒（中央の値 × ${SPECTATORS} 人）`,
	);

	const problems = [...new Set(results.flatMap((r) => r.result.problems))];
	checks.push({
		name: "観戦用の通知の中身が正しい（全員の位置・色・ポーズ・間隔）",
		ok: problems.length === 0,
		detail:
			problems.length === 0
				? `${SPECTATORS} 人`
				: problems.slice(0, 5).join("・"),
	});
	const continued = results.every(
		(r) =>
			r.result.noticesPerGame.length >= 3 &&
			r.result.noticesPerGame.slice(1).every((n) => n > 0) &&
			r.result.gamesWithLooks >= r.result.noticesPerGame.length - 1,
	);
	checks.push({
		name: "次の試合が始まっても、観戦用の通知（色とポーズを含む）を受け取り続ける",
		ok: continued,
		detail: `試合ごとの通知の数（1 人目）: ${results[0]?.result.noticesPerGame.join("・") ?? "-"}`,
	});
	checks.push({
		name: "観戦ルームが送る観戦用の通知は 200 通/秒以下",
		ok: roomRate <= SPECTATORS * MAX_NOTICES_PER_SECOND,
		detail: `約 ${roomRate.toFixed(1)} 通/秒`,
	});
	checks.push({
		name: "カウントの開始が、15 接続すべてに、500 ms 以内に届く（95%）",
		ok:
			latencies.length === ROOMS * PER_ROOM &&
			(latency?.p95 ?? Number.POSITIVE_INFINITY) <= 500,
		detail: `${latencies.length} 接続・95% ${fmt(latency?.p95, 0)} ms`,
	});
	checks.push({
		name: "観戦ルームと同時でも、往復の時間が遅れない（95% が、前の 95% + 50 ms 以内）",
		ok:
			during.length === TRIPS &&
			(duringTrips?.p95 ?? Number.POSITIVE_INFINITY) <=
				(beforeTrips?.p95 ?? 0) + 50,
		detail: `前 ${fmt(beforeTrips?.p95, 0)} ms・同時 ${fmt(duringTrips?.p95, 0)} ms`,
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
process.exit(printChecks("観戦ルームの試験", checks) ? 0 : 1);
