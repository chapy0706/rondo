/**
 * 体の向き（issue-57）。体は、スティックを倒した方向（世界の向きに直したもの）へ、なめらかに回る。
 * 視点の向き（yaw）とは分ける（視点は、これまでどおり視点パッドで回す）。止まったら、最後の向きを保つ。
 * 向きはサーバーの約束（x 軸から z 軸の向きへ回るラジアン）で、移動の報告にも、この向きを載せる。
 * three を使わない純粋な関数で、時間は dt（秒）で受け取る。
 */

/** 体が回る速さ（ラジアン/秒。720°/秒）。 */
export const BODY_TURN_SPEED = 4 * Math.PI;

/** 角度を -π〜π に直す。 */
function normalize(angle: number): number {
	const turned =
		angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
	return turned === -Math.PI ? Math.PI : turned;
}

/**
 * スティックの入力 input（VirtualPad の約束: y は下が正）と視点の向き yaw から、進む向き（サーバーの
 * 向き）。倒していなければ null。進む向きの求め方は rules.ts の walkTarget と同じ。
 */
export function facingTarget(
	input: { readonly x: number; readonly y: number },
	yaw: number,
): number | null {
	const forward = -input.y;
	const right = input.x;
	if (forward === 0 && right === 0) return null;
	const dx = -Math.sin(yaw) * forward + Math.cos(yaw) * right;
	const dz = -Math.cos(yaw) * forward - Math.sin(yaw) * right;
	return Math.atan2(dz, dx);
}

/** current から target へ、近い回り方で、最大 maxStep だけ回した向き（-π〜π）。 */
export function turnToward(
	current: number,
	target: number,
	maxStep: number,
): number {
	const diff = normalize(target - current);
	if (Math.abs(diff) <= maxStep) return normalize(target);
	return normalize(current + Math.sign(diff) * maxStep);
}

/** 毎コマの体の向き。倒していなければ、current のまま。 */
export function stepFacing(
	current: number,
	input: { readonly x: number; readonly y: number },
	yaw: number,
	dtSeconds: number,
): number {
	const target = facingTarget(input, yaw);
	if (target === null) return current;
	return turnToward(current, target, BODY_TURN_SPEED * Math.max(0, dtSeconds));
}
