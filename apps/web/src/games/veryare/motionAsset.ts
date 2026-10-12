/**
 * 動きの素材（character-motions / issue-57）の計算。素材を作る道具（tools/character_motions.mjs）と、
 * 素材の検査のテストが、同じこの関数を使う。three も JSON も読まない純粋な関数（道具が Node で、型を
 * 取り除いてそのまま読むため）。
 *
 * - 根（Hips）の、前へ進む分だけを直線で引く（detrendRoot）。最初から最後までの水平の移動を、時間に
 *   比例して引くので、進む向きがどちらでも（体の向きを回しても）同じように消え、左右・前後の小さな
 *   揺れと上下の動きは残る。最初と最後の水平の位置がそろうので、繰り返しの継ぎ目はなめらかなまま
 * - 歩幅（strideOf）は、1 周期で進む水平の距離。標準の速さ = 歩幅 ÷ 1 周期の秒数
 */

type V3 = readonly [number, number, number];

/**
 * 根の位置 positions（時刻 times）から、水平の2軸 horizontal の、最初から最後までの移動を、時間に
 * 比例して引いた位置。上下の軸は変えない。
 */
export function detrendRoot(
	times: readonly number[],
	positions: readonly V3[],
	horizontal: readonly [number, number],
): [number, number, number][] {
	const first = positions[0];
	const last = positions[positions.length - 1];
	const t0 = times[0] ?? 0;
	const t1 = times[times.length - 1] ?? 0;
	if (first === undefined || last === undefined || t1 <= t0) {
		return positions.map((p) => [p[0], p[1], p[2]]);
	}
	const [a, b] = horizontal;
	const da = (last[a] ?? 0) - (first[a] ?? 0);
	const db = (last[b] ?? 0) - (first[b] ?? 0);
	return positions.map((p, i) => {
		const k = ((times[i] ?? t0) - t0) / (t1 - t0);
		const out: [number, number, number] = [p[0], p[1], p[2]];
		out[a] = (p[a] ?? 0) - da * k;
		out[b] = (p[b] ?? 0) - db * k;
		return out;
	});
}

/** 水平の2軸の、範囲の大きいほう（最大 − 最小）。 */
export function horizontalRange(
	positions: readonly V3[],
	horizontal: readonly [number, number],
): number {
	const span = (axis: number) => {
		const values = positions.map((p) => p[axis] ?? 0);
		return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
	};
	return Math.max(span(horizontal[0]), span(horizontal[1]));
}

/** 歩幅（最初から最後までの、水平の距離）。 */
export function strideOf(
	positions: readonly V3[],
	horizontal: readonly [number, number],
): number {
	const first = positions[0];
	const last = positions[positions.length - 1];
	if (first === undefined || last === undefined) return 0;
	return Math.hypot(
		(last[horizontal[0]] ?? 0) - (first[horizontal[0]] ?? 0),
		(last[horizontal[1]] ?? 0) - (first[horizontal[1]] ?? 0),
	);
}

/** 親の行列（列の順の 4×4）で、場面の上（y）にいちばん向く、ノードの軸の番号（0〜2）。 */
export function upAxisOf(parent: ArrayLike<number>): number {
	const ups = [0, 1, 2].map((axis) => {
		const x = parent[axis * 4] ?? 0;
		const y = parent[axis * 4 + 1] ?? 0;
		const z = parent[axis * 4 + 2] ?? 0;
		const length = Math.hypot(x, y, z);
		return length === 0 ? 0 : Math.abs(y) / length;
	});
	return ups.indexOf(Math.max(...ups));
}

/** 動きの骨のうち、体に無いもの。 */
export function missingBones(
	tracks: readonly string[],
	body: readonly string[],
): string[] {
	const known = new Set(body);
	return tracks.filter((name) => !known.has(name));
}

/** 最初と最後の姿勢の差（骨ごとの回転の差の角度の最大。度）。四元数は [x, y, z, w]。 */
export function seamAngle(
	first: readonly (readonly number[])[],
	last: readonly (readonly number[])[],
): number {
	let worst = 0;
	first.forEach((a, i) => {
		const b = last[i];
		if (b === undefined) return;
		const dot = Math.abs(
			(a[0] ?? 0) * (b[0] ?? 0) +
				(a[1] ?? 0) * (b[1] ?? 0) +
				(a[2] ?? 0) * (b[2] ?? 0) +
				(a[3] ?? 0) * (b[3] ?? 0),
		);
		worst = Math.max(worst, 2 * Math.acos(Math.min(1, dot)));
	});
	return (worst * 180) / Math.PI;
}
