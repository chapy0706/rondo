/**
 * 不正な入力の試験（issue-51）。攻撃役の接続から、壊れた電文・未知の種別・バイナリ・深い入れ子・
 * 短時間の大量送信を送り、次を確かめる。極端に大きな1通は tools/flood.sh（make の外）で確かめる。
 *
 * - サーバーが落ちない（別の接続がふつうに話せる）
 * - 同じルームの別の利用者（victim）への影響が小さい: list-rooms の往復時間を、送る前と大量送信の
 *   間とで比べる。victim のルームの進行（立候補でカウントが始まる）も、最後に確かめる
 *
 *   node src/trials/garbage.ts [--burst 2000]     （tools/load.sh garbage から呼ぶ）
 */

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
import { markdownTable, memorySummary, summarize } from "./stats.ts";

const burst = Number(option("--burst") ?? 2_000);
const checks: Check[] = [];
const everyone: Bot[] = [];
const stopSampling = startSampling(500);

/** victim の list-rooms の往復時間（ms）。届かなければ null。 */
async function roundTrip(victim: Bot): Promise<number | null> {
	const since = victim.received.length;
	const sentAt = Date.now();
	victim.send({ type: "list-rooms", gameType: GAME_TYPE });
	try {
		const reply = await victim.waitFor(
			(m) =>
				m.type === "room-list" &&
				victim.received.findIndex((r) => r.message === m) >= since,
			5_000,
			"room-list",
		);
		const at = victim.received.find((r) => r.message === reply)?.at ?? sentAt;
		return at - sentAt;
	} catch {
		return null;
	}
}

async function roundTrips(victim: Bot, n: number): Promise<(number | null)[]> {
	const out: (number | null)[] = [];
	for (let i = 0; i < n; i++) {
		out.push(await roundTrip(victim));
		await sleep(20);
	}
	return out;
}

try {
	const [attacker, victim] = (await connectBots("garbage", 2)) as [Bot, Bot];
	everyone.push(attacker, victim);
	const made = await create(victim);
	if (made.type !== "room-joined") throw new Error("ルームを作れない");
	const roomId = made.roomId;
	await join(attacker, roomId);
	const baseline = await roundTrips(victim, 20);

	// 1. 壊れた電文・形の違う電文・未知の種別・バイナリ・深い入れ子。
	const deep = 100_000;
	const samples: [string, string | Uint8Array][] = [
		["空の文字列", ""],
		["JSON でない", "not json"],
		["閉じていない JSON", '{"type":"set-name"'],
		["配列", "[1,2,3]"],
		["null", "null"],
		["type が無い", "{}"],
		["type が数", '{"type":42}'],
		["未知の種別", '{"type":"unknown","x":1}'],
		["項目の型が違う", '{"type":"join-room","gameType":1,"roomId":true}'],
		[
			"別のルーム宛てのゲーム内イベント",
			JSON.stringify({
				type: "game-event",
				gameType: GAME_TYPE,
				roomId: "room-none",
				payload: { type: "move", x: 1, z: 1 },
			}),
		],
		[
			"形の違うゲーム内イベント",
			JSON.stringify({
				type: "game-event",
				gameType: GAME_TYPE,
				roomId,
				payload: { type: "move", x: "1", z: null, facing: "NaN" },
			}),
		],
		[
			"極端な数",
			JSON.stringify({
				type: "game-event",
				gameType: GAME_TYPE,
				roomId,
				payload: { type: "move", x: 1e308, z: -1e308, facing: 1e308 },
			}),
		],
		[
			"JSON で書けない数",
			'{"type":"game-event","gameType":"veryare","roomId":"r","payload":{"x":1e400}}',
		],
		[`深い入れ子（${deep} 段）`, `${"[".repeat(deep)}${"]".repeat(deep)}`],
		[
			`深い入れ子のゲーム内イベント（${deep} 段）`,
			`{"type":"game-event","gameType":"veryare","roomId":"${roomId}","payload":${"[".repeat(deep)}${"]".repeat(deep)}}`,
		],
		["バイナリ（1 KiB）", new Uint8Array(1024).map((_, i) => i % 256)],
	];
	for (const [, data] of samples) attacker.sendRaw(data);
	await sleep(500);
	const afterSamples = await roundTrips(victim, 10);
	checks.push({
		name: `壊れた・形の違う電文（${samples.length} 種）の後も、別の利用者は話せる`,
		ok: afterSamples.every((t) => t !== null),
		detail: `種類: ${samples.map(([name]) => name).join("、")}。攻撃役の接続は ${attacker.isClosed ? "閉じられた" : "開いたまま"}`,
	});

	// 2. 短時間の大量送信（同じ接続から、待たずに）。移動・一覧・未知の種別・待機ポーズ・いいね。
	const flooder = (await connectBots("garbage-flood", 1))[0] as Bot;
	everyone.push(flooder);
	await join(flooder, roomId);
	const during = roundTrips(victim, 30);
	const startedAt = Date.now();
	for (let i = 0; i < burst; i++) {
		move(flooder, roomId, Math.sin(i) * 2, Math.cos(i) * 2, i);
		flooder.send({ type: "list-rooms", gameType: GAME_TYPE });
		flooder.sendRaw('{"type":"unknown"}');
		flooder.send({
			type: "game-event",
			gameType: GAME_TYPE,
			roomId,
			payload: { type: "waiting-pose", pose: "femaleDance" },
		});
		flooder.send({
			type: "game-event",
			gameType: GAME_TYPE,
			roomId,
			payload: { type: "like", target: victim.playerId },
		});
	}
	const sendMs = Date.now() - startedAt;
	const duringTimes = await during;
	await sleep(1_000);
	const after = await roundTrips(victim, 20);

	const base = summarize(baseline.filter((t): t is number => t !== null));
	const busy = summarize(duringTimes.filter((t): t is number => t !== null));
	const calm = summarize(after.filter((t): t is number => t !== null));
	const memory = memorySummary(stopSampling());
	const fmt = (v: number | undefined) => (v === undefined ? "-" : v.toFixed(0));
	console.log(
		`\n## 大量送信（${burst} 回 × 5 通 = ${burst * 5} 通を ${sendMs} ms で送った）\n`,
	);
	console.log(
		markdownTable(
			[
				"victim の list-rooms の往復（ms）",
				"中央",
				"95%",
				"最大",
				"届かなかった",
			],
			[
				[
					"送る前",
					fmt(base?.p50),
					fmt(base?.p95),
					fmt(base?.max),
					String(baseline.filter((t) => t === null).length),
				],
				[
					"大量送信の間",
					fmt(busy?.p50),
					fmt(busy?.p95),
					fmt(busy?.max),
					String(duringTimes.filter((t) => t === null).length),
				],
				[
					"大量送信の後",
					fmt(calm?.p50),
					fmt(calm?.p95),
					fmt(calm?.max),
					String(after.filter((t) => t === null).length),
				],
			],
		),
	);
	if (memory !== null) {
		console.log(
			`\nサーバーの RSS: 始め ${memory.startMb.toFixed(1)} MiB・最大 ${memory.maxMb.toFixed(1)} MiB・終わり ${memory.endMb.toFixed(1)} MiB。CPU の最大 ${memory.cpuMax.toFixed(1)}%`,
		);
	}
	checks.push({
		name: "大量送信の間も、別の利用者の往復はすべて返る",
		ok: duringTimes.every((t) => t !== null),
		detail: `届かなかった: ${duringTimes.filter((t) => t === null).length} 回`,
	});
	checks.push({
		name: "大量送信の後、別の利用者の往復は、送る前の水準に戻る（95% が 100 ms 以内）",
		ok: (calm?.p95 ?? Number.POSITIVE_INFINITY) <= 100,
		detail: `後の 95%: ${fmt(calm?.p95)} ms（前 ${fmt(base?.p95)} ms）`,
	});

	// 3. victim のルームの進行: 攻撃役と大量送信の接続を出してから、2人目を入れ、立候補でカウントが始まる。
	leaveAll([attacker, flooder]);
	const [second] = (await connectBots("garbage-second", 1)) as [Bot];
	everyone.push(second);
	await join(second, roomId);
	move(victim, roomId, 0, 0);
	const counting = await victim
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
		name: "不正な入力の後も、victim のルームは進む（立候補でカウントが始まる）",
		ok: counting,
		detail: counting ? "カウントの開始が届いた" : "届かない",
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
	detail: "list-rooms に room-list が返るか",
});
process.exit(printChecks("不正な入力の試験", checks) ? 0 : 1);
