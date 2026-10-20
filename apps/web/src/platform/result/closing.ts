/**
 * 結果画面の、ルームが閉じるまでの残り（issue-70 / ADR 0050）。表示だけで、閉じる判断はサーバーが持つ。
 * 残りは game-ended の closesInMs（通知を作った時点からの残り）。
 */

/** 閉じる時刻（ミリ秒）。受け取った時刻 receivedAt + 残り。残りが無ければ null（表示しない）。 */
export function closingDeadline(
	closesInMs: number | null,
	receivedAt: number,
): number | null {
	return closesInMs === null ? null : receivedAt + closesInMs;
}

/** 閉じるまでの残りの秒（切り上げ）。過ぎていれば 0。 */
export function secondsUntil(deadline: number, now: number): number {
	return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** 結果画面に小さく出す文。 */
export function closingText(seconds: number): string {
	return seconds > 0
		? `あと ${seconds} 秒で、ロビーへ戻ります`
		: "まもなく、ロビーへ戻ります";
}
