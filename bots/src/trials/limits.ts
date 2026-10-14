/**
 * 上限の試験（issue-51 / ADR 0030）。実際のサーバーで、次を確かめる。
 *
 * 1. veryare の同時ルームは3つまで。4つ目の作成は room-limit で断られる
 * 2. 定員は5人。6人目の参加は room-full で断られる
 * 3. 退出で空きが戻る: 1人だけのルームの人が退出すると、ルームが消え、4つ目を作れる
 * 4. 終了で空きが戻る: ルームのゲームが終わる（不成立）と、作れるようになる。終わったルームに
 *    人が残っている間と、全員が退出した後の両方を見る
 *
 *   node src/trials/limits.ts      （tools/load.sh limits から呼ぶ。フェーズ時間を縮めたサーバーで）
 */

import type { Bot } from "../client.ts";
import {
	type Check,
	connectBots,
	create,
	errorCode,
	join,
	leaveAll,
	move,
	printChecks,
	serverHealthy,
	sleep,
} from "./harness.ts";

const checks: Check[] = [];
const everyone: Bot[] = [];
const roomOf = (message: { type: string; roomId?: string }) =>
	message.type === "room-joined" ? (message.roomId ?? null) : null;

try {
	// 1. 3つ作り、4つ目が断られる。
	const creators = await connectBots("limit-creator", 4);
	everyone.push(...creators);
	const rooms: string[] = [];
	for (const bot of creators.slice(0, 3)) {
		const r = await create(bot);
		const id = roomOf(r);
		if (id === null) throw new Error(`作れない: ${JSON.stringify(r)}`);
		rooms.push(id);
	}
	const fourth = await create(creators[3] as Bot);
	checks.push({
		name: "4つ目のルームは断られる",
		ok: errorCode(fourth) === "room-limit",
		detail: `返事: ${fourth.type === "error" ? fourth.code : fourth.type}`,
	});

	// 2. 1つ目のルームを5人にして、6人目が断られる。
	const joiners = await connectBots("limit-joiner", 5);
	everyone.push(...joiners);
	const results = [];
	for (const bot of joiners) results.push(await join(bot, rooms[0] as string));
	const accepted = results.slice(0, 4).every((r) => r.type === "room-joined");
	checks.push({
		name: "5人目までは入れ、6人目は満員で断られる",
		ok: accepted && errorCode(results[4] as never) === "room-full",
		detail: `2〜5人目: ${accepted ? "入れた" : "入れなかった"} ・6人目: ${
			(results[4] as { type: string; code?: string }).type === "error"
				? (results[4] as { code: string }).code
				: (results[4] as { type: string }).type
		}`,
	});

	// 3. 1人だけのルーム（3つ目）の人が退出すると、空きが戻る。
	(creators[2] as Bot).send({
		type: "leave-room",
		roomId: rooms[2] as string,
	});
	await sleep(300);
	const afterLeave = await create(creators[3] as Bot);
	const freedRoom = roomOf(afterLeave);
	checks.push({
		name: "退出でルームが消え、空きが戻る",
		ok: freedRoom !== null,
		detail: `退出の後の作成: ${afterLeave.type === "error" ? afterLeave.code : "作れた"}`,
	});

	// 4. 2つ目のルームを2人にしてカウントを始め、1人が抜けて不成立で終わらせる。
	const extra = await connectBots("limit-extra", 2);
	everyone.push(...extra);
	await join(extra[0] as Bot, rooms[1] as string);
	move(creators[1] as Bot, rooms[1] as string, 0, 0);
	await (creators[1] as Bot).waitFor(
		(m) =>
			m.type === "game-state" &&
			(m.payload as { area?: unknown }).area === "counting",
		5_000,
		"カウントの開始",
	);
	(extra[0] as Bot).send({ type: "leave-room", roomId: rooms[1] as string });
	const ended = await (creators[1] as Bot).waitFor(
		(m) => m.type === "game-ended",
		15_000,
		"game-ended（不成立）",
	);
	await sleep(300);
	// 終わったルームに、作った人がまだ残っている間。
	const whileStaying = await create(extra[1] as Bot);
	const stayingRoom = roomOf(whileStaying);
	checks.push({
		name: "終わったルームに人が残っている間も、空きが戻る",
		ok: stayingRoom !== null,
		detail: `game-ended の後（残っている間）の作成: ${whileStaying.type === "error" ? whileStaying.code : "作れた"}（終わり方: ${ended.type === "game-ended" ? ended.result.rankings.map((r) => r.result.details?.結果).join("・") : "?"}）`,
	});
	// 残っていた人も退出した後。
	if (stayingRoom === null) {
		(creators[1] as Bot).send({
			type: "leave-room",
			roomId: rooms[1] as string,
		});
		await sleep(300);
		const afterAll = await create(extra[1] as Bot);
		checks.push({
			name: "終わったルームから全員が退出すると、空きが戻る",
			ok: roomOf(afterAll) !== null,
			detail: `全員の退出の後の作成: ${afterAll.type === "error" ? afterAll.code : "作れた"}`,
		});
	}
} catch (error) {
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
const ok = printChecks("上限の試験", checks);
process.exit(ok ? 0 : 1);
