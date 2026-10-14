/**
 * ボットが受け取った電文から、いま見ている状態を求める（issue-51 の乱れた通信の確かめ）。純粋な関数。
 */

import type { ServerMessage } from "@rondo/contracts";

/**
 * ルーム roomId の参加者として見えている人。最後の room-joined の一覧から始め、その後の参加
 * （player-joined）・退出（player-left）の知らせを当てる。room-joined が無ければ空。
 */
export function playersSeen(
	messages: readonly ServerMessage[],
	roomId: string,
): ReadonlySet<string> {
	let start = -1;
	messages.forEach((m, i) => {
		if (m.type === "room-joined" && m.roomId === roomId) start = i;
	});
	if (start < 0) return new Set();
	const first = messages[start] as Extract<
		ServerMessage,
		{ type: "room-joined" }
	>;
	const seen = new Set(first.players.map((p) => p.playerId));
	for (const m of messages.slice(start + 1)) {
		if (m.type === "player-joined" && m.roomId === roomId) {
			seen.add(m.player.playerId);
		}
		if (m.type === "player-left" && m.roomId === roomId) {
			seen.delete(m.playerId);
		}
	}
	return seen;
}
