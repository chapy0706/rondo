/**
 * 画面の上部バーに出す、規則の名前（ADR 0053）。ルーム情報（room-info）の roaming・spreading から決める
 * 純粋関数。動ける規則は「動ける」、増え鬼は「増え鬼」（両方なら並べる）、従来の規則は空（何も出さない）。
 * 上部バーは基盤の部品（platform/host/GameFrame）なので、基盤は games/registry の roomBadgeOf を通して読む。
 */

import { roamingOfRoomInfo, spreadingOfRoomInfo } from "./roaming";

/** ルーム情報（unknown）から、規則の名前。ルーム情報でなければ null（いまの表示を変えない）。 */
export function ruleBadgeOf(payload: unknown): string | null {
	const roaming = roamingOfRoomInfo(payload);
	const spreading = spreadingOfRoomInfo(payload);
	if (roaming === null || spreading === null) return null;
	return [roaming ? "動ける" : null, spreading ? "増え鬼" : null]
		.filter((name) => name !== null)
		.join("・");
}
