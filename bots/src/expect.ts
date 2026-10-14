/**
 * シナリオの結果の検査（issue-49）。純粋な関数にして、サーバーなしでテストする。
 * 問題があれば、人が読める文として並べて返す（空なら成功）。
 */

import type { RankingEntry, ServerMessage } from "@rondo/contracts";
import type { ExpectedRow, Scenario } from "./scenario.ts";

/**
 * game-ended の検査。got はボットの名前ごとに、届いた game-ended（届かなければ無し）。
 * ids はボットの名前から、サーバーが発行したプレイヤー識別子への対応。
 */
export function checkGameEnded(
	scenario: Scenario,
	ids: ReadonlyMap<string, string>,
	got: ReadonlyMap<string, ServerMessage | undefined>,
): string[] {
	const problems: string[] = [];
	const results: {
		bot: string;
		message: Extract<ServerMessage, { type: "game-ended" }>;
	}[] = [];
	for (const bot of scenario.receivers) {
		const message = got.get(bot);
		if (message?.type !== "game-ended") {
			problems.push(`${bot} に game-ended が届かない`);
			continue;
		}
		results.push({ bot, message });
	}
	const first = results[0];
	if (first === undefined) return problems;

	for (const { bot, message } of results.slice(1)) {
		if (
			JSON.stringify(message.result) !== JSON.stringify(first.message.result)
		) {
			problems.push(`${bot} の結果が ${first.bot} と違う`);
		}
	}

	const { order, rankings } = first.message.result;
	if (order !== "higher-is-better") {
		problems.push(`order が higher-is-better でない: ${order}`);
	}
	for (const expected of scenario.rankings) {
		const id = ids.get(expected.bot);
		const actual = rankings.find((entry) => entry.playerId === id);
		if (actual === undefined) {
			problems.push(`${expected.bot} が結果にいない`);
			continue;
		}
		if (!rowMatches(expected, actual)) {
			problems.push(
				`${expected.bot} の行が違う: 期待 ${describeExpected(expected)} / 実際 ${describeActual(actual)}`,
			);
		}
	}
	const expectedIds = new Set(scenario.rankings.map((row) => ids.get(row.bot)));
	const extra = rankings.filter((entry) => !expectedIds.has(entry.playerId));
	if (extra.length > 0) {
		problems.push(
			`期待にない人が結果にいる: ${extra.map((e) => e.name).join(", ")}`,
		);
	}
	const ranks = rankings.map((entry) => entry.rank);
	if (ranks.some((rank, i) => i > 0 && rank < (ranks[i - 1] ?? rank))) {
		problems.push("結果が順位の順に並んでいない");
	}
	return problems;
}

function rowMatches(expected: ExpectedRow, actual: RankingEntry): boolean {
	return (
		actual.rank === expected.rank &&
		actual.result.score === expected.score &&
		actual.name === expected.bot &&
		sameDetails(expected.details, actual.result.details ?? {})
	);
}

/**
 * 見逃しポイントといいね（issue-32）。値は隠れた場所と鬼の動きで変わるので、期待には書かず、隠れ側の
 * 行に 0 以上の整数として載っていることだけを確かめる。
 */
const SCORE_KEYS = ["見逃し", "いいね"] as const;

function isCount(value: string | number | undefined): boolean {
	return value !== undefined && /^\d+$/.test(String(value));
}

/**
 * 期待に書いたキーがすべて同じ値で、それ以外のキーは見逃し・いいねだけ。隠れ側の行には、見逃し・
 * いいねが 0 以上の整数で載っている。
 */
function sameDetails(
	expected: Readonly<Record<string, string | number>>,
	actual: Readonly<Record<string, string | number>>,
): boolean {
	const listed = Object.keys(expected).every(
		(key) => expected[key] === actual[key],
	);
	const extra = Object.keys(actual).filter(
		(key) =>
			!(key in expected) && !(SCORE_KEYS as readonly string[]).includes(key),
	);
	const counts =
		expected.役割 !== "隠れる側" ||
		SCORE_KEYS.every((key) => key in expected || isCount(actual[key]));
	return listed && extra.length === 0 && counts;
}

function formatDetails(d: Readonly<Record<string, string | number>>): string {
	return `{${Object.entries(d)
		.map(([k, v]) => `${k}:${v}`)
		.join(", ")}}`;
}

function describeExpected(row: ExpectedRow): string {
	return `${row.rank}位 score ${row.score} ${formatDetails(row.details)} name ${row.bot}`;
}

function describeActual(entry: RankingEntry): string {
	return `${entry.rank}位 score ${entry.result.score} ${formatDetails(entry.result.details ?? {})} name ${entry.name}`;
}

/** 限定配信の検査に使う、ボット1人分の記録。 */
export interface TargetedLog {
	readonly name: string;
	readonly playerId: string;
	readonly messages: readonly ServerMessage[];
}

/**
 * 限定配信（ADR 0021）の検査。宛先でないボットに game-state-to が届いていないこと。
 * 1通も観測できなければ、確かめられなかったとして挙げる。
 */
export function checkTargeted(logs: readonly TargetedLog[]): string[] {
	const problems: string[] = [];
	let observed = 0;
	for (const log of logs) {
		for (const message of log.messages) {
			if (message.type !== "game-state-to") continue;
			observed += 1;
			if (message.to !== log.playerId) {
				problems.push(`${log.name} に、宛先 ${message.to} の限定配信が届いた`);
			}
		}
	}
	if (observed === 0) problems.push("限定配信が1通も観測できず、確認できない");
	return problems;
}

/** シナリオ1本の結果。 */
export interface ScenarioResult {
	readonly name: string;
	readonly ok: boolean;
	readonly ms: number;
	readonly problems: readonly string[];
}

/** 結果の表（Markdown の表の形。端末でもそのまま読める）。 */
export function formatTable(results: readonly ScenarioResult[]): string {
	const rows = results.map(
		(r) =>
			`| ${r.name} | ${r.ok ? "成功" : "失敗"} | ${(r.ms / 1000).toFixed(1)}秒 | ${r.problems.join(" / ")} |`,
	);
	return [
		"| シナリオ | 結果 | 時間 | 問題 |",
		"| --- | --- | --- | --- |",
		...rows,
	].join("\n");
}

/**
 * ルーム名の確かめ（issue-58）。作成の返事（room-joined）と、一覧（room-list）の、このルームの
 * 名前が expected か。違えば問題を返す。
 */
export function checkRoomName(
	expected: string,
	roomId: string,
	created: ServerMessage,
	listing: ServerMessage,
): string[] {
	const problems: string[] = [];
	const joinedName =
		created.type === "room-joined" ? created.roomName : undefined;
	if (joinedName !== expected) {
		problems.push(
			`作成の返事のルーム名が「${joinedName ?? "なし"}」（期待は「${expected}」）`,
		);
	}
	const listed =
		listing.type === "room-list"
			? listing.rooms.find((room) => room.roomId === roomId)
			: undefined;
	if (listed?.name !== expected) {
		problems.push(
			`一覧のルーム名が「${listed?.name ?? "なし"}」（期待は「${expected}」）`,
		);
	}
	return problems;
}

/** 期待する待機ルームのメンバー（issue-59）。playerId はサーバーが発行した識別子。 */
export interface ExpectedMember {
	readonly playerId: string;
	readonly x: number;
	readonly z: number;
	readonly pose: string | null;
}

interface WaitingMemberLike {
	readonly playerId: string;
	readonly x: number;
	readonly z: number;
	readonly pose: string | null;
}

/** 電文が待機ルームのメンバーの通知なら、そのメンバーの一覧。 */
function membersOf(
	message: ServerMessage,
): readonly WaitingMemberLike[] | null {
	if (message.type !== "game-state" && message.type !== "game-state-to") {
		return null;
	}
	const payload = message.payload as { type?: unknown; members?: unknown };
	if (payload.type !== "members" || !Array.isArray(payload.members)) {
		return null;
	}
	return payload.members as WaitingMemberLike[];
}

function isPhaseOtherThanSelection(message: ServerMessage): boolean {
	if (message.type !== "game-state") return false;
	const payload = message.payload as { type?: unknown; phase?: unknown };
	return payload.type === "phase" && payload.phase !== "oni-selection";
}

/** 位置の比べ方（サーバーが小数第 2 位に丸めるので、その半分まで許す）。 */
const POSITION_TOLERANCE = 0.005;

/**
 * 待機ルームのメンバーの確かめ（issue-59）。ボットごとの受け取った電文（logs）の、最新のメンバーの
 * 通知に、期待するメンバーが同じ位置・ポーズで載っているか。全員の最新が同じ内容か。
 */
export function checkMembers(
	check: string,
	expected: readonly ExpectedMember[],
	logs: ReadonlyMap<string, readonly ServerMessage[]>,
): string[] {
	const problems: string[] = [];
	const latest: string[] = [];
	for (const [name, messages] of logs) {
		const notices = messages
			.map(membersOf)
			.filter((m): m is readonly WaitingMemberLike[] => m !== null);
		const last = notices.at(-1);
		if (last === undefined) {
			problems.push(`${check}: ${name} にメンバーの通知が届いていない`);
			continue;
		}
		latest.push(JSON.stringify(last));
		for (const want of expected) {
			const got = last.find((m) => m.playerId === want.playerId);
			const same =
				got !== undefined &&
				Math.abs(got.x - want.x) <= POSITION_TOLERANCE &&
				Math.abs(got.z - want.z) <= POSITION_TOLERANCE &&
				got.pose === want.pose;
			if (!same) {
				const seen =
					got === undefined
						? "なし"
						: `(${got.x}, ${got.z})・${got.pose ?? "null"}`;
				problems.push(
					`${check}: ${name} に届いた ${want.playerId} は ${seen}（期待は (${want.x}, ${want.z})・${want.pose ?? "null"}）`,
				);
			}
		}
	}
	if (new Set(latest).size > 1) {
		problems.push(`${check}: 最新のメンバーの通知が、ボットによって違う`);
	}
	return problems;
}

/**
 * 鬼選出の後（鬼選出以外のフェーズの通知の後）に、待機の通知が届いていないか（issue-59）。
 */
export function checkMembersStopped(
	name: string,
	messages: readonly ServerMessage[],
): string[] {
	const start = messages.findIndex(isPhaseOtherThanSelection);
	if (start < 0) return [];
	const late = messages.slice(start).filter((m) => membersOf(m) !== null);
	return late.length === 0
		? []
		: [`${name} に、鬼選出の後で待機の通知が ${late.length} 通届いた`];
}
