/**
 * 鬼の視界の報告（issue-32 / ADR 0036）。three を使わない純粋な関数。
 *
 * 探索フェーズの間、人間の鬼のクライアントが 0.5 秒ごとに、カメラの視界に遮るものなく入っている
 * 隠れ側（壁越しを除く。判定は scene.sightedHiders）を、サーバーへ報告する。圏内（距離）の判定と
 * 見逃しポイントの加算はサーバーが行う（性善説 / ADR 0035）。
 */

import type { PlayerId, VeryareSightEvent } from "@rondo/contracts";
import type { Phase, Role } from "./rules";

/** 報告の間隔（ミリ秒）。サーバーの見逃しポイントの加算の間隔（game.missed_tick_ms）と同じ。 */
export const SIGHT_REPORT_MS = 500;

/** 報告するか。探索中の鬼（観戦でない）だけ。 */
export function canReportSight(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly spectator: boolean;
}): boolean {
	return (
		options.phase === "exploration" &&
		options.role === "oni" &&
		!options.spectator
	);
}

/** いま報告するか（前の報告から SIGHT_REPORT_MS たったか。まだ報告していなければ、すぐ）。 */
export function shouldReportSight(
	time: number,
	lastSent: number | null,
): boolean {
	return lastSent === null || time - lastSent >= SIGHT_REPORT_MS;
}

/** 報告の電文（契約の VeryareSightEvent）。同じ人は1回だけ、並びは決まった順（比べやすいように）。 */
export function sightEvent(ids: readonly PlayerId[]): VeryareSightEvent {
	return { type: "sight", playerIds: [...new Set(ids)].sort() };
}
