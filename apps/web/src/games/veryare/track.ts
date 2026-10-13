/**
 * とびとびに届く位置の通知を、なめらかに描くための補間（issue-46 の鬼の補間を、issue-59 で一般化）。
 * three を使わない。
 *
 * 届いた通知を時刻つきで2〜3個持ち、少し遅らせた時刻の位置を、前後2つの通知から直線で補間する。
 * 最新より先は延ばさず、最新の位置で止める。向きは近い回り方で補間する。間が大きく空いた（止まって
 * いた）あとに動き出したときは、前の位置を新しい通知の少し前に置き直し、止まっていた長い間を
 * ゆっくり補間しない。
 *
 * 使う側: 鬼（oniTrack.ts。遅れは届いた間隔の実測）と、待機ルームのメンバー（members.ts。遅れは
 * 送る間隔の約 1.5 倍の定数）。
 */

/** 届いた通知。at は受け取った時刻（ミリ秒）。facing はサーバーの向き（ラジアン）。 */
export interface TrackSample {
	readonly at: number;
	readonly x: number;
	readonly z: number;
	readonly facing: number;
}

/** 置き直しの決まり。間が gapMs を超えたら、前の位置を新しい通知の reseatMs 前に置き直す。 */
export interface ReseatRule {
	readonly gapMs: number;
	readonly reseatMs: number;
}

/** 遅らせる時間の下限・上限（ミリ秒）。 */
export interface DelayLimits {
	readonly minDelayMs: number;
	readonly maxDelayMs: number;
}

/** 持つ通知の数。 */
const KEEP = 3;

/**
 * 通知を足す。3個を超えたら古いものから捨てる。間が rule.gapMs を超えたら、前の位置を置き直す。
 * 時刻が戻った通知は、前の通知の直後として扱う。
 */
export function pushSample(
	track: readonly TrackSample[],
	sample: TrackSample,
	rule: ReseatRule,
): readonly TrackSample[] {
	const last = track.at(-1);
	if (last === undefined) return [sample];
	const next = sample.at > last.at ? sample : { ...sample, at: last.at + 1 };
	if (next.at - last.at > rule.gapMs) {
		return [{ ...last, at: next.at - rule.reseatMs }, next];
	}
	return [...track, next].slice(-KEEP);
}

/** 遅らせる時間（届いた間隔の平均。下限・上限で切る）。通知が1つ以下なら下限。 */
export function trackDelay(
	track: readonly TrackSample[],
	limits: DelayLimits,
): number {
	if (track.length < 2) return limits.minDelayMs;
	const first = track[0] as TrackSample;
	const last = track.at(-1) as TrackSample;
	const interval = (last.at - first.at) / (track.length - 1);
	return Math.min(limits.maxDelayMs, Math.max(limits.minDelayMs, interval));
}

/** 角度を (-π, π] に収める。 */
function wrap(angle: number): number {
	const turned =
		angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
	return turned === -Math.PI ? Math.PI : turned;
}

/** 時刻 time の位置と向き。前後2つの通知から直線で補間する。通知が無ければ null。 */
export function sampleTrack(
	track: readonly TrackSample[],
	time: number,
): { x: number; z: number; facing: number } | null {
	const first = track[0];
	const last = track.at(-1);
	if (first === undefined || last === undefined) return null;
	const pick = (p: TrackSample) => ({ x: p.x, z: p.z, facing: p.facing });
	if (time <= first.at) return pick(first);
	if (time >= last.at) return pick(last);
	for (let i = 1; i < track.length; i++) {
		const a = track[i - 1] as TrackSample;
		const b = track[i] as TrackSample;
		if (time > b.at) continue;
		const t = (time - a.at) / (b.at - a.at);
		return {
			x: a.x + (b.x - a.x) * t,
			z: a.z + (b.z - a.z) * t,
			facing: wrap(a.facing + wrap(b.facing - a.facing) * t),
		};
	}
	return pick(last);
}
