/**
 * ボット同士の対戦を流し、結果を表で出す（issue-49）。`make bots` から呼ぶ。
 *
 *   node src/main.ts [--seed N] [--only シナリオ名の一部]
 *
 * - 接続先: 環境変数 RONDO_BOTS_URL（既定 ws://localhost:3300/ws）
 * - 終了コード: 全シナリオが成功なら 0、1つでも失敗なら 1
 */

import { formatTable } from "./expect.ts";
import { runScenario } from "./runner.ts";
import { scenarios } from "./scenarios.ts";

const url = process.env.RONDO_BOTS_URL ?? "ws://localhost:3300/ws";
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const seed = Number(option("--seed") ?? Date.now() % 1_000_000);
const only = option("--only");

const chosen = scenarios.filter(
	(s) => only === undefined || s.name.includes(only),
);
if (chosen.length === 0) {
	console.error(`当てはまるシナリオがない: ${only}`);
	process.exit(1);
}

console.log(`接続先 ${url} ・種 ${seed}（同じ種で再現: --seed ${seed}）`);
const results = [];
for (const scenario of chosen) {
	const result = await runScenario(scenario, {
		url,
		seed,
		createSocket: (target) => new WebSocket(target),
	});
	console.log(`${result.ok ? "成功" : "失敗"}: ${scenario.name}`);
	results.push(result);
}
console.log("");
console.log(formatTable(results));
process.exit(results.every((r) => r.ok) ? 0 : 1);
