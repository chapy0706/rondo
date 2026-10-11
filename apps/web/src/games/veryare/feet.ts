/**
 * 体の足もとの高さを、床の高さへなめらかに寄せる（issue-46）。three を使わない。
 *
 * 平屋では床の高さがマスごとに違う（畳 0.6 m、土間 0.4 m など / hiraya.ts の floorHeight）。段差で
 * 体が跳ねないよう、足もとの高さを、FOOT_SETTLE_SECONDS で段差の 95% を追う速さで寄せる（指数の
 * 追従。行き過ぎない）。空間が変わったときなど、寄せずに合わせたいときは、呼ぶ側が床の高さを直に使う。
 */

/** 段差の 95% を追うまでの時間（秒）。 */
export const FOOT_SETTLE_SECONDS = 0.12;

/** 寄せきったとみなす差（メートル）。これより近ければ、床の高さに合わせる。 */
const SNAP = 0.001;

/** 95% を追う時間から決めた、指数の追従の時定数（e^-3 ≒ 5%）。 */
const TIME_CONSTANT = FOOT_SETTLE_SECONDS / 3;

/** いまの足もとの高さ current を、床の高さ target へ、dt 秒ぶん寄せた高さ。 */
export function followFloor(
	current: number,
	target: number,
	dtSeconds: number,
): number {
	if (dtSeconds <= 0) return current;
	const next =
		target + (current - target) * Math.exp(-dtSeconds / TIME_CONSTANT);
	return Math.abs(next - target) < SNAP ? target : next;
}
