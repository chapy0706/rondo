/**
 * 極端に大きな電文を1本の接続から送り、サーバーが落ちず、ほかの接続が影響を受けないことを
 * 確かめる（issue-51）。`make flood` から呼ぶ。画面もブラウザも使わない。
 *
 *   node src/flood.ts [--size-mb N] [--url ws://...]
 *
 * - 接続 A（攻撃役）: session を受け取ってから、N MiB の1通を送る。ソケット1本のメモリの
 *   上限（server の connection/heap_guard: 64 MiB）を超えると、サーバーはその接続だけを落とす。
 *   超えなければ、ふつうに受け取って捨てる（どちらでも、サーバーは落ちない）。
 * - 接続 B（別の利用者）: A のあとに list-rooms を送り、room-list が返ることを確かめる
 *   （サーバーが生きていて、ほかの接続が影響を受けていないことの確認）。
 * - 終了コード: B に room-list が返れば 0、返らなければ 1。
 */

import { Bot } from "./client.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const url =
	option("--url") ?? process.env.RONDO_BOTS_URL ?? "ws://localhost:3300/ws";
const sizeMb = Number(option("--size-mb") ?? 80);
const createSocket = (target: string) => new WebSocket(target);

console.log(`接続先 ${url} ・大きさ ${sizeMb} MiB の1通を送る`);

const attacker = await Bot.connect(url, "flood-a", createSocket);
// N MiB の、形は正しいが巨大な電文（受信バッファを膨らませる）。
const huge = "A".repeat(sizeMb * 1024 * 1024);
const before = Date.now();
attacker.send({
	type: "set-name",
	playerId: attacker.playerId ?? "",
	name: huge,
});
console.log(`[flood] ${sizeMb} MiB を送った（${Date.now() - before}ms）`);

// 攻撃役の接続が閉じるのを、最大 5 秒まで短い間隔で待つ（受信・上限超過・切断には時間がかかる）。
const closeDeadline = Date.now() + 5_000;
while (!attacker.isClosed && Date.now() < closeDeadline) {
	await new Promise((resolve) => setTimeout(resolve, 100));
}
console.log(
	`[flood] 攻撃役の接続は ${attacker.isClosed ? "閉じられた" : "まだ開いている"}（送信から ${Date.now() - before}ms 待った）`,
);

// 別の利用者が、サーバーとふつうに話せるか。
let healthy = false;
try {
	const other = await Bot.connect(url, "flood-b", createSocket);
	other.send({ type: "list-rooms", gameType: "veryare" });
	await other.waitFor((m) => m.type === "room-list", 5_000, "room-list");
	healthy = true;
	other.close();
} catch (error) {
	console.error(`[flood] 別の接続が応答しない: ${String(error)}`);
}

console.log(
	healthy
		? "成功: サーバーは生きていて、別の接続はふつうに話せる"
		: "失敗: 別の接続が応答しない（サーバーが落ちた可能性）",
);
// 上限が効いたかの目安（サーバーのログの行の有無は、tools/flood.sh が判定して表示する）。
console.log(
	attacker.isClosed
		? "判定: 攻撃役の接続は閉じられた（上限が効いた見込み）"
		: "判定: 攻撃役の接続は開いたまま（上限が効いていない可能性。サーバーのログの行と OTP の版を確認）",
);
attacker.close();
process.exit(healthy ? 0 : 1);
