/**
 * 答え合わせタイムの視点の切り替えと、いいね（issue-32 / ADR 0036）。three を使わない純粋な関数。
 *
 * - 答え合わせの間、探索の開始に届いた隠れ側全員（見つかった人も、逃げ切った人も、自分も）の隠れ場所
 *   を中心にした TPS 視点へ、次へ・前へで切り替えられる。null は自分の視点
 * - いいねは、見ている隠れ側（自分以外）へ、1人1回まで送れる（サーバーも同じ決まりで受け付ける）
 * - いいねの数は、変わるたびに全員へ届く（隠れ側ごと。0 を含む）
 */

import type { PlayerId, VeryareLikeEvent } from "@rondo/contracts";
import type { Phase } from "./rules";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** いいねの数の通知（unknown）を検証する。形が違えば null。 */
export function parseLikesNotice(
	payload: unknown,
): ReadonlyMap<PlayerId, number> | null {
	if (!isRecord(payload) || payload.type !== "likes") return null;
	if (!Array.isArray(payload.likes)) return null;
	const counts = new Map<PlayerId, number>();
	for (const entry of payload.likes as unknown[]) {
		if (!isRecord(entry)) return null;
		const { playerId, count } = entry;
		if (typeof playerId !== "string") return null;
		if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
			return null;
		}
		counts.set(playerId, count);
	}
	return counts;
}

/** 切り替える先（探索の開始に届いた隠れ側の通知の順）。届いていなければ空。 */
export function revealTargets(
	hiders: readonly { readonly playerId: PlayerId }[] | null,
): readonly PlayerId[] {
	return hiders === null ? [] : hiders.map((hider) => hider.playerId);
}

/**
 * 次へ（step 1）・前へ（step -1）。自分の視点（null）・一覧に無い人からは、先頭（次へ）か末尾
 * （前へ）へ。切り替える先が無ければ null（自分の視点のまま）。
 */
export function stepRevealTarget(
	targets: readonly PlayerId[],
	current: PlayerId | null,
	step: 1 | -1,
): PlayerId | null {
	if (targets.length === 0) return null;
	const index = current === null ? -1 : targets.indexOf(current);
	if (index < 0) {
		return (step === 1 ? targets[0] : targets.at(-1)) ?? null;
	}
	const next = (index + step + targets.length) % targets.length;
	return targets[next] ?? null;
}

/** いいねを送れるか。答え合わせの間、見ている隠れ側（自分以外）へ、まだ送っていなければ。 */
export function canLike(options: {
	readonly phase: Phase;
	readonly target: PlayerId | null;
	readonly you: PlayerId | null;
	readonly liked: ReadonlySet<PlayerId>;
}): boolean {
	const { phase, target, you, liked } = options;
	return (
		phase === "reveal" &&
		target !== null &&
		target !== you &&
		!liked.has(target)
	);
}

/** いいねの電文（契約の VeryareLikeEvent）。 */
export function likeEvent(target: PlayerId): VeryareLikeEvent {
	return { type: "like", target };
}
