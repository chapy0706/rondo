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

function sameDetails(
	a: Readonly<Record<string, string | number>>,
	b: Readonly<Record<string, string | number>>,
): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].every((key) => a[key] === b[key]);
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
