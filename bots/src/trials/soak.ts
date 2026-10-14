/**
 * 長時間の放置の試験（issue-51 / issue-41）。待機ルームに5人を入れて、何もしないまま minutes 分
 * つなぎ続け、次を確かめる。
 *
 * - 切断が起きない（ハートビートの ping に pong を返し続ける。サーバーにも、途中の経路にも切られない）
 * - ping が、およそ 20 秒ごとに届き続ける
 * - サーバーのメモリが増え続けない（RSS を 10 秒ごとに取り、1時間あたりの増え方を求める）
 * - 終わりに、まだ同じルームで話せる（立候補でカウントが始まる）
 *
 *   node src/trials/soak.ts [--minutes 60] [--url wss://...]     （tools/load.sh soak から呼ぶ）
 *
 * 本番（Cloudflare 経由）で確かめるときは、docs/load-tests.md の手順で、--url を付けて直接呼ぶ
 * （サーバーは立てない。メモリは、A1 の上で別に測る）。
 */

import type { Bot } from "../client.ts";
import {
	type Check,
	connectBots,
	create,
	join,
	leaveAll,
	move,
	option,
	printChecks,
	sleep,
	startSampling,
} from "./harness.ts";
import { markdownTable, memorySummary } from "./stats.ts";

const minutes = Number(option("--minutes") ?? 60);
/** ハートビートの間隔（issue-41。サーバーの既定）。 */
const PING_MS = 20_000;
const checks: Check[] = [];
const everyone: Bot[] = [];

try {
	const bots = await connectBots("soak", 5);
	everyone.push(...bots);
	const [host, ...rest] = bots as [Bot, ...Bot[]];
	const made = await create(host);
	if (made.type !== "room-joined") throw new Error("ルームを作れない");
	for (const bot of rest) await join(bot, made.roomId);
	const pingsBefore = bots.map((b) => b.all("ping").length);
	const stopSampling = startSampling(10_000);
	const startedAt = Date.now();
	console.log(`[soak] 5人が待機ルームにそろった。${minutes} 分つなぎ続ける`);

	// 1 分ごとに、つながっている人数を出す（途中で切れたら分かるように）。
	let closedAt: number | null = null;
	while (Date.now() - startedAt < minutes * 60_000) {
		await sleep(Math.min(60_000, minutes * 60_000 - (Date.now() - startedAt)));
		const open = bots.filter((b) => !b.isClosed).length;
		const elapsed = ((Date.now() - startedAt) / 60_000).toFixed(1);
		console.log(`[soak] ${elapsed} 分: つながっている ${open} / 5`);
		if (open < 5 && closedAt === null) closedAt = Date.now() - startedAt;
	}
	const samples = stopSampling();
	const elapsedMs = Date.now() - startedAt;
	const pings = bots.map(
		(b, i) => b.all("ping").length - (pingsBefore[i] ?? 0),
	);
	const expectedPings = Math.floor(elapsedMs / PING_MS);

	checks.push({
		name: `${minutes} 分の間、切断が起きない`,
		ok: closedAt === null,
		detail:
			closedAt === null
				? "5人ともつながったまま"
				: `${(closedAt / 60_000).toFixed(1)} 分ごろに切れた`,
	});
	checks.push({
		name: "ping が、およそ 20 秒ごとに届き続ける",
		ok: pings.every((n) => n >= expectedPings - 1),
		detail: `届いた ping: ${pings.join("・")}（期待 およそ ${expectedPings}）`,
	});
	const memory = memorySummary(samples);
	if (memory !== null) {
		console.log(
			`\n## 長時間の放置（${(elapsedMs / 60_000).toFixed(1)} 分、5人、待機ルーム）\n`,
		);
		console.log(
			markdownTable(
				["サーバー", "値"],
				[
					["RSS の始め（MiB）", memory.startMb.toFixed(1)],
					["RSS の最大（MiB）", memory.maxMb.toFixed(1)],
					["RSS の終わり（MiB）", memory.endMb.toFixed(1)],
					[
						"RSS の増え方（MiB/時。最小二乗の傾き）",
						memory.growthMbPerHour.toFixed(2),
					],
					["CPU の平均（%）", memory.cpuMean.toFixed(2)],
					["見本の数（10 秒ごと）", String(samples.length)],
				],
			),
		);
		checks.push({
			name: "サーバーのメモリが増え続けない（増え方が 1時間あたり 20 MiB 未満）",
			ok: memory.growthMbPerHour < 20,
			detail: `${memory.growthMbPerHour.toFixed(2)} MiB/時`,
		});
	}

	// 終わりに、同じルームで話せる。
	move(host, made.roomId, 0, 0);
	const counting = await host
		.waitFor(
			(m) =>
				m.type === "game-state" &&
				(m.payload as { area?: unknown }).area === "counting",
			5_000,
			"カウントの開始",
		)
		.then(() => true)
		.catch(() => false);
	checks.push({
		name: "放置のあとも、同じルームで話せる（立候補でカウントが始まる）",
		ok: counting,
		detail: counting ? "カウントの開始が届いた" : "届かない",
	});
} catch (error) {
	checks.push({
		name: "試験の途中",
		ok: false,
		detail: error instanceof Error ? error.message : String(error),
	});
} finally {
	leaveAll(everyone);
}

process.exit(printChecks("長時間の放置の試験", checks) ? 0 : 1);
