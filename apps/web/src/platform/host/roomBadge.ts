/**
 * 上部バーに出す、ルームの規則の名前の置き場（ADR 0053。「動ける」「増え鬼」など）。ゲームの側が、ルームの
 * 設定を読んで名前を渡し（setRoomBadge）、基盤の上部バー（PlayHost → GameFrame）が読む。基盤はゲームの中身を
 * 知らず、渡された文字を出すだけ（空なら出さない）。
 *
 * ゲームの通知を基盤の側で購読しないのは、届く前の通知の送り直し（session.ts の ReplayBuffer）が、ルームごとに
 * 最初の購読者にだけ渡す作りのため（基盤が先に購読すると、ゲームが受け取れなくなる）。
 */

import { useSyncExternalStore } from "react";

/** ルーム ID → 規則の名前。 */
const badges = new Map<string, string>();
const listeners = new Set<() => void>();

/** ゲームの側が呼ぶ。そのルームの規則の名前（空なら出さない）。 */
export function setRoomBadge(roomId: string, badge: string): void {
	if (badges.get(roomId) === badge) return;
	badges.set(roomId, badge);
	for (const listener of [...listeners]) listener();
}

/** そのルームの規則の名前（渡されていなければ空）。 */
export function roomBadge(roomId: string | null): string {
	return roomId === null ? "" : (badges.get(roomId) ?? "");
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 上部バーが使う。そのルームの規則の名前（渡されたら描き直す）。 */
export function useRoomBadge(roomId: string | null): string {
	return useSyncExternalStore(
		subscribe,
		() => roomBadge(roomId),
		() => "",
	);
}
