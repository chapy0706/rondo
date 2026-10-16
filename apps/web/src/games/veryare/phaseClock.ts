/**
 * フェーズの残り時間（ADR 0046）。three と React を使わない純粋な関数。
 *
 * フェーズの通知の長さ（durationMs）は、「通知を作った時点からの残り」。フェーズの開始のときの通知は、
 * 残り = フェーズの長さ。途中参加・復帰（再読み込み・再接続・画面ロックのあと）の送り直しでは、
 * サーバーが、その時点の残りを入れる。画面は、受け取った時刻から経過を引いて、残りを数える。
 *
 * 中身の同じ通知（長さも同じ）は無視し、受け取った時刻を変えない（controls.ts の sameNotice）。長さが
 * 違えば、新しい通知として、残りを届いた値に合わせ直す。
 *
 * 残り時間を使う所: 画面の上の残り秒数、ペイントの板のロック（残り 2 秒）、塗りの自動確定
 * （shouldSubmitPaint）、塗れるか（canEditPaint）。「フェーズの全体の長さ」として使う所は無い。
 */

import { sameNotice } from "./controls";
import type { PhaseNotice } from "./rules";

export interface PhaseClock {
	readonly notice: PhaseNotice | null;
	/** 通知を受け取った時刻（ミリ秒。performance.now の時計）。 */
	readonly receivedAt: number;
}

export const NO_PHASE_CLOCK: PhaseClock = { notice: null, receivedAt: 0 };

/** 通知を受け取る。中身の同じ通知なら、clock をそのまま返す。 */
export function receivePhase(
	clock: PhaseClock,
	notice: PhaseNotice,
	at: number,
): PhaseClock {
	if (sameNotice(clock.notice, notice)) return clock;
	return { notice, receivedAt: at };
}

/**
 * 時刻 now の残り（ミリ秒。0 から届いた値の間）。長さを持たない通知・通知が無いときは無限。
 * now が受け取った時刻より前（受け取った直後の描き直しが、前の更新の時刻を使うとき）でも、届いた値を
 * 超えない（残り 2 秒以下の通知が届いた直後に、塗りの自動確定を送るため）。
 */
export function remainingOf(clock: PhaseClock, now: number): number {
	const duration = clock.notice?.durationMs ?? null;
	if (duration === null) return Number.POSITIVE_INFINITY;
	const elapsed = Math.max(0, now - clock.receivedAt);
	return Math.max(0, duration - elapsed);
}
