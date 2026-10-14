/**
 * 乱れた通信の試験（issue-51 / ADR 0013）。1ルーム5人で、次を確かめる。
 *
 * 1. 猶予内の復帰: 接続を切って、猶予（10 秒）より前に、復帰トークンで同じプレイヤーとして戻れる。
 *    ほかの人には、離脱が伝わらない
 * 2. 猶予切れ: 猶予より長く切れたままだと、離脱が確定し（ほかの人に player-left が届く）、あとから
 *    戻ろうとしても reconnect-failed で断られる
 * 3. 他人のトークン: つながっている人の復帰トークンを、別の接続が使っても、戻れない（断られる）。
 *    トークンの持ち主は、ルームに残ったまま
 * 4. 乱れたあとの矛盾なし: ランダムに切って戻すのを rounds 回くり返したあと、全員が見ている参加者が
 *    同じで、一覧（list-rooms）の人数とも合う。立候補すると、全員にカウントの開始が届く（フェーズが揃う）
 *
 *   node src/trials/chaos.ts [--rounds 20] [--seed N]     （tools/load.sh chaos から呼ぶ）
 */

import { Bot } from "../client.ts";
import { seeded } from "../runner.ts";
import {
	url,
	type Check,
	GAME_TYPE,
	connectBots,
	create,
	createSocket,
	join,
	leaveAll,
	move,
	option,
	printChecks,
	serverHealthy,
	sleep,
} from "./harness.ts";
import { playersSeen } from "./views.ts";

const rounds = Number(option("--rounds") ?? 20);
const seed = Number(option("--seed") ?? Date.now() % 1_000_000);
const random = seeded(seed);
/** 再接続猶予（ADR 0013）。フェーズ時間を縮めても、これは縮まない。 */
const GRACE_MS = 10_000;

const checks: Check[] = [];
const current = new Map<string, Bot>();
const retired: Bot[] = [];
console.log(
	`[chaos] 種 ${seed}（同じ種で再現: --seed ${seed}）・くり返し ${rounds} 回`,
);

/** 名前のボットの接続を切り、猶予内に戻す。戻れたかを返す。 */
async function dropAndResume(
	name: string,
	roomId: string,
	waitMs: number,
): Promise<boolean> {
	const old = current.get(name);
	if (old === undefined || old.resumeToken === null) return false;
	const token = old.resumeToken;
	const id = old.playerId;
	old.close();
	retired.push(old);
	await sleep(waitMs);
	const fresh = await Bot.reconnect(url, name, createSocket, roomId, token);
	const answer = await fresh.waitFor(
		(m) => m.type === "room-joined" || m.type === "error",
		5_000,
		"復帰の返事",
	);
	current.set(name, fresh);
	return (
		answer.type === "room-joined" &&
		answer.roomId === roomId &&
		answer.you === id
	);
}

try {
	const bots = await connectBots("chaos", 5);
	for (const bot of bots) current.set(bot.name, bot);
	const [a, b, c, d, e] = bots as [Bot, Bot, Bot, Bot, Bot];
	const made = await create(a);
	if (made.type !== "room-joined") throw new Error("ルームを作れない");
	const roomId = made.roomId;
	for (const bot of [b, c, d, e]) await join(bot, roomId);

	// 1. B を切り、2 秒後に戻す。A には離脱が伝わらない。
	const leftBefore = a.all("player-left").length;
	const resumed = await dropAndResume(b.name, roomId, 2_000);
	checks.push({
		name: "猶予内に、同じプレイヤーとして同じルームへ戻れる",
		ok: resumed,
		detail: "切ってから 2 秒後に、復帰トークンで reconnect",
	});
	checks.push({
		name: "猶予内の切断は、ほかの人に伝わらない",
		ok: a.all("player-left").length === leftBefore,
		detail: `A に届いた player-left: ${a.all("player-left").length - leftBefore} 件`,
	});

	// 2. C を猶予より長く切ったままにする。
	const cToken = c.resumeToken ?? "";
	const cId = c.playerId;
	c.close();
	retired.push(c);
	current.delete(c.name);
	const dropAt = Date.now();
	const left = await a.waitFor(
		(m) => m.type === "player-left" && m.playerId === cId,
		GRACE_MS + 5_000,
		"C の離脱の確定",
	);
	const leftAfter = Date.now() - dropAt;
	checks.push({
		name: "猶予を過ぎると、離脱が確定する（ほかの人に player-left）",
		ok: left.type === "player-left",
		detail: `切ってから ${(leftAfter / 1000).toFixed(1)} 秒後に届いた`,
	});
	const late = await Bot.reconnect(
		url,
		"chaos-late",
		createSocket,
		roomId,
		cToken,
	);
	retired.push(late);
	const lateAnswer = await late.waitFor(
		(m) => m.type === "room-joined" || m.type === "error",
		5_000,
		"猶予切れの後の復帰の返事",
	);
	checks.push({
		name: "猶予切れの後は、戻れない",
		ok: lateAnswer.type === "error" && lateAnswer.code === "reconnect-failed",
		detail: `返事: ${lateAnswer.type === "error" ? lateAnswer.code : lateAnswer.type}`,
	});

	// 3. つながっている E のトークンを、別の接続が使う。
	const thief = await Bot.reconnect(
		url,
		"chaos-thief",
		createSocket,
		roomId,
		e.resumeToken ?? "",
	);
	retired.push(thief);
	const thiefAnswer = await thief.waitFor(
		(m) => m.type === "room-joined" || m.type === "error",
		5_000,
		"他人のトークンでの復帰の返事",
	);
	await sleep(300);
	checks.push({
		name: "つながっている人のトークンでは、戻れない",
		ok: thiefAnswer.type === "error",
		detail: `返事: ${thiefAnswer.type === "error" ? thiefAnswer.code : thiefAnswer.type}`,
	});
	checks.push({
		name: "トークンを使われた人は、ルームに残ったまま",
		ok: !a.all("player-left").some((m) => m.playerId === e.playerId),
		detail: "A に E の player-left が届いていない",
	});

	// 4. 残りの4人から、ランダムに選んで切り、0.3〜3 秒で戻す。
	const names = [a.name, b.name, d.name, e.name];
	let failures = 0;
	for (let i = 0; i < rounds; i++) {
		const name = names[Math.floor(random() * names.length)] as string;
		const wait = 300 + Math.floor(random() * 2_700);
		if (!(await dropAndResume(name, roomId, wait))) failures++;
	}
	checks.push({
		name: `ランダムな切断と復帰（${rounds} 回）で、毎回戻れる`,
		ok: failures === 0,
		detail: `戻れなかった回: ${failures}`,
	});

	await sleep(500);
	const expected = [...current.values()]
		.map((bot) => bot.playerId ?? "")
		.sort();
	const views = [...current.values()].map((bot) =>
		[
			...playersSeen(
				bot.received.map((r) => r.message),
				roomId,
			),
		].sort(),
	);
	const agree = views.every(
		(view) => JSON.stringify(view) === JSON.stringify(expected),
	);
	checks.push({
		name: "乱れたあと、全員が見ている参加者が同じで、実際の4人と合う",
		ok: agree,
		detail: `見えている人数: ${views.map((v) => v.length).join("・")}（期待 ${expected.length}）`,
	});
	const probe = await Bot.connect(url, "chaos-probe", createSocket);
	retired.push(probe);
	probe.send({ type: "list-rooms", gameType: GAME_TYPE });
	const list = await probe.waitFor(
		(m) => m.type === "room-list",
		5_000,
		"room-list",
	);
	const listed =
		list.type === "room-list"
			? list.rooms.find((room) => room.roomId === roomId)?.playerCount
			: undefined;
	checks.push({
		name: "一覧の人数も、実際の人数と合う",
		ok: listed === expected.length,
		detail: `一覧の人数: ${listed ?? "なし"}`,
	});

	// 立候補して、全員にカウントの開始が届く（フェーズが揃う）。
	const host = current.get(a.name) as Bot;
	move(host, roomId, 0, 0);
	const counted = await Promise.all(
		[...current.values()].map((bot) =>
			bot
				.waitFor(
					(m) =>
						m.type === "game-state" &&
						(m.payload as { area?: unknown }).area === "counting",
					5_000,
					"カウントの開始",
				)
				.then(() => true)
				.catch(() => false),
		),
	);
	checks.push({
		name: "乱れたあとも、立候補でカウントの開始が全員に届く",
		ok: counted.every(Boolean),
		detail: `届いた人数: ${counted.filter(Boolean).length} / ${counted.length}`,
	});
} catch (error) {
	checks.push({
		name: "試験の途中",
		ok: false,
		detail: error instanceof Error ? error.message : String(error),
	});
} finally {
	leaveAll([...current.values()]);
	for (const bot of retired) bot.close();
}

await sleep(300);
checks.push({
	name: "試験の後も、サーバーは別の接続とふつうに話せる",
	ok: await serverHealthy(),
	detail: "list-rooms に room-list が返るか",
});
process.exit(printChecks("乱れた通信の試験", checks) ? 0 : 1);
