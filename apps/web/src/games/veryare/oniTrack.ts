/**
 * ほかの人の画面での鬼の体の動き（issue-46）。補間の中身は track.ts（issue-59 で一般化）にあり、
 * ここは鬼の値で呼ぶだけ。
 *
 * 鬼の位置は、サーバーの鬼の通知（全員宛て）で、とびとびに届く（人間の鬼は約 50 ms ごと、鬼 CPU は
 * 0.5 秒ごと）。届いた通知を時刻つきで2〜3個持ち、少し遅らせた時刻（届いた間隔の実測。下限 100 ms・
 * 上限 600 ms）の位置を、前後2つの通知から直線で補間して描く。最新より先は延ばさず、最新の位置で
 * 止める。向きは近い回り方で補間する。
 *
 * 鬼本人の画面では使わない（自分の体を、手元の位置と向きで動かす）。
 */

import {
	type TrackSample,
	trackDelay as delayOf,
	pushSample,
	sampleTrack,
} from "./track";

/** 届いた鬼の通知。at は受け取った時刻（ミリ秒）。 */
export type OniSample = TrackSample;

/** 遅らせる時間の下限・上限（ミリ秒）。 */
export const ONI_TRACK_MIN_DELAY_MS = 100;
export const ONI_TRACK_MAX_DELAY_MS = 600;

/**
 * 通知を足す。3個を超えたら古いものから捨てる。間が大きく空いた（上限の2倍を超えた。鬼が止まって
 * いた）ときは、前の位置を、新しい通知の少し前（下限の遅れ）に置き直す。時刻が戻った通知は、前の
 * 通知の直後として扱う。
 */
export function pushOniSample(
	track: readonly OniSample[],
	sample: OniSample,
): readonly OniSample[] {
	return pushSample(track, sample, {
		gapMs: ONI_TRACK_MAX_DELAY_MS * 2,
		reseatMs: ONI_TRACK_MIN_DELAY_MS,
	});
}

/** 遅らせる時間（届いた間隔の平均。下限・上限で切る）。通知が1つ以下なら下限。 */
export function trackDelay(track: readonly OniSample[]): number {
	return delayOf(track, {
		minDelayMs: ONI_TRACK_MIN_DELAY_MS,
		maxDelayMs: ONI_TRACK_MAX_DELAY_MS,
	});
}

/** 時刻 time の鬼の位置と向き。前後2つの通知から直線で補間する。通知が無ければ null。 */
export function sampleOni(
	track: readonly OniSample[],
	time: number,
): { x: number; z: number; facing: number } | null {
	return sampleTrack(track, time);
}
