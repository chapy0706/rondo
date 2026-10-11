/**
 * ほかの人の画面での鬼の体の動き（issue-46）。three を使わない。
 *
 * 鬼の位置は、サーバーの鬼の通知（全員宛て）で、とびとびに届く（人間の鬼は約 50 ms ごと、鬼 CPU は
 * 0.5 秒ごと）。届いた通知を時刻つきで2〜3個持ち、少し遅らせた時刻（届いた間隔の実測。下限 100 ms・
 * 上限 600 ms）の位置を、前後2つの通知から直線で補間して描く。最新より先は延ばさず、最新の位置で
 * 止める。向きは近い回り方で補間する。
 *
 * 鬼本人の画面では使わない（自分の体を、手元の位置と向きで動かす）。
 */

/** 届いた鬼の通知。at は受け取った時刻（ミリ秒）。 */
export interface OniSample {
	readonly at: number;
	readonly x: number;
	readonly z: number;
	readonly facing: number;
}

/** 遅らせる時間の下限・上限（ミリ秒）。 */
export const ONI_TRACK_MIN_DELAY_MS = 100;
export const ONI_TRACK_MAX_DELAY_MS = 600;

/** 持つ通知の数。 */
const KEEP = 3;

/**
 * 通知を足す。3個を超えたら古いものから捨てる。間が大きく空いた（鬼が止まっていた）ときは、前の位置を、
 * 新しい通知の少し前（下限の遅れ）に置き直す（止まっていた長い間を、ゆっくり補間しないため）。
 * 時刻が戻った通知は、前の通知の直後として扱う。
 */
export function pushOniSample(
	track: readonly OniSample[],
	sample: OniSample,
): readonly OniSample[] {
	const last = track.at(-1);
	if (last === undefined) return [sample];
	const next = sample.at > last.at ? sample : { ...sample, at: last.at + 1 };
	if (next.at - last.at > ONI_TRACK_MAX_DELAY_MS * 2) {
		return [{ ...last, at: next.at - ONI_TRACK_MIN_DELAY_MS }, next];
	}
	return [...track, next].slice(-KEEP);
}

/** 遅らせる時間（届いた間隔の平均。下限・上限で切る）。通知が1つ以下なら下限。 */
export function trackDelay(track: readonly OniSample[]): number {
	if (track.length < 2) return ONI_TRACK_MIN_DELAY_MS;
	const first = track[0] as OniSample;
	const last = track.at(-1) as OniSample;
	const interval = (last.at - first.at) / (track.length - 1);
	return Math.min(
		ONI_TRACK_MAX_DELAY_MS,
		Math.max(ONI_TRACK_MIN_DELAY_MS, interval),
	);
}

/** 角度を (-π, π] に収める。 */
function wrap(angle: number): number {
	const turned =
		angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
	return turned === -Math.PI ? Math.PI : turned;
}

/** 時刻 time の鬼の位置と向き。前後2つの通知から直線で補間する。通知が無ければ null。 */
export function sampleOni(
	track: readonly OniSample[],
	time: number,
): { x: number; z: number; facing: number } | null {
	const first = track[0];
	const last = track.at(-1);
	if (first === undefined || last === undefined) return null;
	const pick = (p: OniSample) => ({ x: p.x, z: p.z, facing: p.facing });
	if (time <= first.at) return pick(first);
	if (time >= last.at) return pick(last);
	for (let i = 1; i < track.length; i++) {
		const a = track[i - 1] as OniSample;
		const b = track[i] as OniSample;
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
