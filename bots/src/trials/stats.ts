/**
 * 試験（issue-51）の結果の集計。純粋な関数にして、サーバーなしでテストする。
 */

/** 小さい順に並んだ値の、nearest-rank の p パーセンタイル（0〜100）。 */
export function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export interface Summary {
	readonly count: number;
	readonly min: number;
	readonly p50: number;
	readonly p95: number;
	readonly max: number;
	readonly mean: number;
}

/** 件数・最小・中央・95%・最大・平均。空なら null。 */
export function summarize(values: readonly number[]): Summary | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		min: sorted[0] as number,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted.at(-1) as number,
		mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
	};
}

/** 件数を秒あたりに直す。 */
export function perSecond(count: number, ms: number): number {
	return ms <= 0 ? 0 : (count * 1000) / ms;
}

/** サーバーのプロセスの見本（ps の RSS は KiB、CPU は %）。at はミリ秒。 */
export interface ProcessSample {
	readonly at: number;
	readonly rssKb: number;
	readonly cpu: number;
}

export interface MemorySummary {
	readonly startMb: number;
	readonly endMb: number;
	readonly maxMb: number;
	/** 1時間あたりの増え方（MiB。最小二乗の傾き）。 */
	readonly growthMbPerHour: number;
	readonly cpuMean: number;
	readonly cpuMax: number;
}

/** メモリと CPU の見本をまとめる。空なら null。 */
export function memorySummary(
	samples: readonly ProcessSample[],
): MemorySummary | null {
	const first = samples[0];
	const last = samples.at(-1);
	if (first === undefined || last === undefined) return null;
	const mb = (s: ProcessSample) => s.rssKb / 1024;
	const n = samples.length;
	const meanAt = samples.reduce((sum, s) => sum + s.at, 0) / n;
	const meanMb = samples.reduce((sum, s) => sum + mb(s), 0) / n;
	let covariance = 0;
	let variance = 0;
	for (const s of samples) {
		covariance += (s.at - meanAt) * (mb(s) - meanMb);
		variance += (s.at - meanAt) ** 2;
	}
	const slopePerMs = variance === 0 ? 0 : covariance / variance;
	return {
		startMb: mb(first),
		endMb: mb(last),
		maxMb: Math.max(...samples.map(mb)),
		growthMbPerHour: slopePerMs * 3_600_000,
		cpuMean: samples.reduce((sum, s) => sum + s.cpu, 0) / n,
		cpuMax: Math.max(...samples.map((s) => s.cpu)),
	};
}

/** 見出しと行を Markdown の表にする。 */
export function markdownTable(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
): string {
	const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
	return [
		line(headers),
		line(headers.map(() => "---")),
		...rows.map(line),
	].join("\n");
}
