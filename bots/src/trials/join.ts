/**
 * 参加・復帰の組み合わせ表の試験（途中参加の人に、いまの状態が届くか）。joinMatrix.ts の表を、
 * 実際のサーバーで、1 つずつ回す（同時ルーム数の上限があるので、順に）。
 *
 * 組み合わせごとに:
 * 1. 作った人がルームを作る（CPU の設定つき。ランダム間取り。広い屋敷の構成（issue-65）は、広い屋敷だけ）。3 人目の組み合わせでは、もう 1 人が先に入る
 * 2. 時機まで進める（カウント中・準備移動・ペイント・探索・答え合わせは、作った人が鬼希望エリアに触れる）
 * 3. 参加する人が入る。鬼選出の間なら、届いた通知（種類とフェーズの中身）を、最初の参加者（作った人）の
 *    ものと比べる。続けて、つなぎ直して（復帰）、もう一度比べる。鬼選出の後なら、断られる
 *    （game-already-started）ことを確かめ、作った人の復帰で届く状態を比べる
 *    どの比べ方でも、いちばん新しいルーム情報の探索時間が、組み合わせの値（広い屋敷は +80 秒）か確かめる
 * 4. 作った人の組み合わせでは、作成で届いた状態（メンバーの通知は除く / ADR 0044）と、2 人目が入った
 *    あとに、作った人に 2 人が載ったメンバーの通知が届くことと、復帰で届く状態を確かめる
 *
 *   node src/trials/join.ts [--only 名前の一部]     （tools/load.sh join から呼ぶ。フェーズ時間は 1/20）
 */

import type { ServerMessage } from "@rondo/contracts";
import { Bot } from "../client.ts";
import { HIDE_MAX_DISTANCE } from "../runner.ts";
import { readStageNotice, spreadSpots } from "../stage.ts";
import {
	url,
	type Check,
	connectBots,
	create,
	createSocket,
	errorCode,
	join,
	leaveAll,
	move,
	option,
	printChecks,
	reply,
	sleep,
} from "./harness.ts";
import {
	CPU_SETTING,
	type JoinCase,
	MOMENT_PHASE,
	joinCases,
	judgeArrival,
	membersListed,
	resentResult,
	wideJoinCases,
} from "./joinMatrix.ts";

/** 参加・復帰のあと、通知がそろうのを待つ時間（ミリ秒）。 */
const SETTLE_MS = 400;
/** 時機まで進むのを待つ上限（ミリ秒。縮めたフェーズ時間なら、答え合わせまで数秒）。 */
const REACH_MS = 20_000;

/** 受け取ったゲームの通知の中身（since 番目の電文から）。 */
function payloads(bot: Bot, since = 0): unknown[] {
	return bot.received
		.slice(since)
		.flatMap(({ message }) =>
			message.type === "game-state" || message.type === "game-state-to"
				? [message.payload]
				: [],
		);
}

function isPhase(
	message: ServerMessage,
	test: (payload: Record<string, unknown>) => boolean,
): boolean {
	if (message.type !== "game-state" && message.type !== "game-state-to") {
		return false;
	}
	const payload = message.payload;
	return (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { type?: unknown }).type === "phase" &&
		test(payload as Record<string, unknown>)
	);
}

/**
 * 準備移動に入ったら、隠れ側の人間を、玄関から別々の場所へ動かす（全員が玄関に現れるので、
 * 重なって失格し、ゲームが終わってしまわないように）。
 */
function hideOnPreparation(bot: Bot, roomId: string, index: number): void {
	const off = bot.onMessage((message) => {
		if (!isPhase(message, (p) => p.phase === "preparation")) return;
		off();
		const payload = (message as { payload: { oni?: unknown } }).payload;
		if (payload.oni === bot.playerId) return;
		const stage = payloads(bot)
			.map(readStageNotice)
			.find((s) => s !== null);
		if (stage == null) return;
		const spot = spreadSpots(stage, index + 1, HIDE_MAX_DISTANCE)[index];
		if (spot !== undefined) move(bot, roomId, spot.x, spot.z);
	});
}

/** 復帰（つなぎ直し）。新しい接続と、その接続で届いた返事。 */
async function resume(
	old: Bot,
	roomId: string,
): Promise<{ bot: Bot; answer: ServerMessage }> {
	const token = old.resumeToken ?? "";
	old.close();
	const bot = await Bot.reconnect(url, old.name, createSocket, roomId, token);
	const answer = await reply(bot, 0);
	return { bot, answer };
}

async function runCase(c: JoinCase): Promise<Check> {
	const bots: Bot[] = [];
	const problems: string[] = [];
	try {
		const [creator, filler, joiner] = await connectBots(`join-${c.cpu}`, 3);
		bots.push(creator as Bot, filler as Bot, joiner as Bot);
		const a = creator as Bot;
		const made = await create(a, { cpu: CPU_SETTING[c.cpu], stage: c.stage });
		if (made.type !== "room-joined") {
			return {
				name: c.name,
				ok: false,
				detail: `作れない: ${errorCode(made)}`,
			};
		}
		const roomId = made.roomId;
		hideOnPreparation(a, roomId, 0);
		await sleep(SETTLE_MS);

		if (c.order === "creator") {
			// 作成で届いた状態（自分自身が最初の参加者）と、復帰で届く状態。
			const created = payloads(a);
			// 作成の時点では、メンバーの通知は届かない（自分しか載らない一覧は送らない / ADR 0044）。
			problems.push(
				...judgeArrival({
					explorationSeconds: c.explorationSeconds,
					arrived: created,
					reference: created,
					atCreation: true,
				}).map((p) => `作成: ${p}`),
			);
			// 2 人目が入ると、作った人にも、2 人が載ったメンバーの通知が届く。
			const second = filler as Bot;
			const entered = await join(second, roomId);
			if (entered.type !== "room-joined") {
				problems.push(`2 人目が入れない: ${errorCode(entered)}`);
			} else {
				const ids = [a.playerId ?? "", second.playerId ?? ""];
				try {
					await a.waitFor(
						() => membersListed(payloads(a), ids),
						REACH_MS,
						"2 人が載ったメンバーの通知",
					);
				} catch {
					problems.push(
						"2 人目が入っても、作った人に 2 人が載ったメンバーの通知が届かない",
					);
				}
			}
			// 復帰で届く状態は、復帰の直前に作った人が持っていたもの（2 人目が入ったので、CPU なしでは
			// エリアが赤から緑に変わっている）と同じ。
			const before = payloads(a);
			const back = await resume(a, roomId);
			bots.push(back.bot);
			if (back.answer.type !== "room-joined") {
				problems.push(`復帰できない: ${errorCode(back.answer)}`);
			} else {
				await sleep(SETTLE_MS);
				problems.push(
					...judgeArrival({
						explorationSeconds: c.explorationSeconds,
						arrived: payloads(back.bot),
						reference: before,
					}).map((p) => `復帰: ${p}`),
				);
			}
			return {
				name: c.name,
				ok: problems.length === 0,
				detail: detail(problems),
			};
		}

		if (c.order === "third") {
			const answer = await join(filler as Bot, roomId);
			if (answer.type !== "room-joined") {
				return {
					name: c.name,
					ok: false,
					detail: `先の人が入れない: ${errorCode(answer)}`,
				};
			}
			hideOnPreparation(filler as Bot, roomId, 1);
		}

		// 時機まで進める。
		if (c.moment !== "waiting") {
			move(a, roomId, 0, 0);
			const phase = MOMENT_PHASE[c.moment];
			await a.waitFor(
				(m) =>
					isPhase(m, (p) =>
						c.moment === "counting" ? p.area === "counting" : p.phase === phase,
					),
				REACH_MS,
				`${c.moment} の通知`,
			);
		}

		const b = joiner as Bot;
		const answer = await join(b, roomId);
		if (c.outcome === "refused") {
			if (errorCode(answer) !== "game-already-started") {
				problems.push(
					`断られない: ${answer.type === "error" ? answer.code : answer.type}`,
				);
			}
			// 作った人の復帰で、その時機の状態が届く（フェーズの中身は、復帰の前に作った人が持っていたものと
			// 同じ。3 人目の組み合わせでは、先にいる人のものとも同じ）。
			const before = payloads(a);
			const back = await resume(a, roomId);
			bots.push(back.bot);
			if (back.answer.type !== "room-joined") {
				problems.push(`作った人が復帰できない: ${errorCode(back.answer)}`);
			} else {
				await sleep(SETTLE_MS);
				const arrived = payloads(back.bot);
				problems.push(
					...judgeArrival({
						explorationSeconds: c.explorationSeconds,
						arrived,
						reference: before,
					}).map((p) => `作った人の復帰: ${p}`),
				);
				// 結果のあと（issue-70）: 戻った人へ、結果が、閉じるまでの残りつきで送り直される。
				if (c.moment === "ended") {
					problems.push(
						...resentResult(back.bot.received.map((r) => r.message)).map(
							(p) => `作った人の復帰: ${p}`,
						),
					);
				}
				if (c.order === "third") {
					problems.push(
						...judgeArrival({
							explorationSeconds: c.explorationSeconds,
							arrived,
							reference: payloads(filler as Bot),
						}).map((p) => `先にいる人と比べて: ${p}`),
					);
				}
			}
			return {
				name: c.name,
				ok: problems.length === 0,
				detail: detail(problems),
			};
		}

		if (answer.type !== "room-joined") {
			return {
				name: c.name,
				ok: false,
				detail: `入れない: ${errorCode(answer)}`,
			};
		}
		await sleep(SETTLE_MS);
		problems.push(
			...judgeArrival({
				explorationSeconds: c.explorationSeconds,
				arrived: payloads(b),
				reference: payloads(a),
			}).map((p) => `参加: ${p}`),
		);
		const back = await resume(b, roomId);
		bots.push(back.bot);
		if (back.answer.type !== "room-joined") {
			problems.push(`復帰できない: ${errorCode(back.answer)}`);
		} else {
			await sleep(SETTLE_MS);
			problems.push(
				...judgeArrival({
					explorationSeconds: c.explorationSeconds,
					arrived: payloads(back.bot),
					reference: payloads(a),
				}).map((p) => `復帰: ${p}`),
			);
		}
		return {
			name: c.name,
			ok: problems.length === 0,
			detail: detail(problems),
		};
	} catch (error) {
		return {
			name: c.name,
			ok: false,
			detail: error instanceof Error ? error.message : String(error),
		};
	} finally {
		leaveAll(bots);
		// 退出が届き、ルームが閉じるのを待つ（同時ルーム数の上限）。
		await sleep(200);
	}
}

function detail(problems: readonly string[]): string {
	return problems.length === 0 ? "同じ状態が届いた" : problems.join(" / ");
}

const only = option("--only");
const cases = [...joinCases(), ...wideJoinCases()].filter(
	(c) => only === undefined || c.name.includes(only),
);
console.log(`[join] 組み合わせ ${cases.length} 件・接続先 ${url}`);
const checks: Check[] = [];
for (const c of cases) {
	const check = await runCase(c);
	console.log(`${check.ok ? "通過" : "失敗"}: ${check.name}`);
	checks.push(check);
}
const ok = printChecks("参加・復帰の組み合わせ表", checks);
process.exit(ok ? 0 : 1);
