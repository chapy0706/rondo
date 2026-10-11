/**
 * デプロイ後の自動確認（issue-50）の、判定のロジック。副作用を持たない純粋関数だけを置き、
 * テストを先に書く。実際の確認（HTTP・WebSocket）は checks.ts、入口は verify.ts。
 *
 * - 項目ごとに独立した結果（ok / failed / skipped）を集める
 * - 1つでも failed があれば、終了コードは 1。無ければ 0（skipped は失敗にしない）
 * - 一時的な失敗（起動直後など）に備え、回数と間隔を指定して再試行できる
 */

export type CheckStatus = "ok" | "failed" | "skipped";

export interface CheckResult {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
}

/** 1回の確認の結果（再試行の単位）。 */
export interface Attempt {
	readonly ok: boolean;
	readonly detail: string;
}

export interface Summary {
	readonly ok: boolean;
	readonly passed: readonly CheckResult[];
	readonly failed: readonly CheckResult[];
	readonly skipped: readonly CheckResult[];
}

export function summarize(results: readonly CheckResult[]): Summary {
	const passed = results.filter((r) => r.status === "ok");
	const failed = results.filter((r) => r.status === "failed");
	const skipped = results.filter((r) => r.status === "skipped");
	return { ok: failed.length === 0, passed, failed, skipped };
}

/** 失敗が1つでもあれば 1、無ければ 0。 */
export function exitCode(results: readonly CheckResult[]): number {
	return summarize(results).ok ? 0 : 1;
}

export interface RetryOptions {
	/** 最初の1回に加えて、何回まで試すか。 */
	readonly retries: number;
	readonly intervalMs: number;
	readonly sleep: (ms: number) => Promise<void>;
}

/**
 * ok になるまで、最大 retries 回まで再試行する。毎回 intervalMs 待つ（最後の失敗の後は待たない）。
 * 返り値は、最後に得た結果と、試した回数。
 */
export async function withRetry(
	attempt: () => Promise<Attempt>,
	options: RetryOptions,
): Promise<Attempt & { readonly attempts: number }> {
	let last: Attempt = { ok: false, detail: "一度も試していない" };
	const total = Math.max(1, options.retries + 1);
	for (let i = 1; i <= total; i++) {
		last = await attempt();
		if (last.ok) return { ...last, attempts: i };
		if (i < total) await options.sleep(options.intervalMs);
	}
	return { ...last, attempts: total };
}

const MARK: Record<CheckStatus, string> = {
	ok: "OK  ",
	failed: "FAIL",
	skipped: "SKIP",
};

/** 結果の一覧を、日付つきの短い文章にする。 */
export function formatReport(
	results: readonly CheckResult[],
	target: string,
	at: Date,
): string {
	const summary = summarize(results);
	const lines = [
		`デプロイ後の確認 ${at.toISOString()}  対象 ${target}`,
		...results.map((r) => `  [${MARK[r.status]}] ${r.name}: ${r.detail}`),
		`結果: ${summary.ok ? "成功" : "失敗"}（成功 ${summary.passed.length} / 失敗 ${summary.failed.length} / 省略 ${summary.skipped.length}）`,
	];
	return lines.join("\n");
}

/** 再試行の結果を、1項目の結果にする。2回以上試したときは、回数を添える。 */
export function toCheckResult(
	name: string,
	result: Attempt & { readonly attempts: number },
): CheckResult {
	const tries = result.attempts > 1 ? `（${result.attempts}回試行）` : "";
	return {
		name,
		status: result.ok ? "ok" : "failed",
		detail: result.detail + tries,
	};
}
