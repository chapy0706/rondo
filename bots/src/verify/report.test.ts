import { describe, expect, it } from "vitest";
import {
	type CheckResult,
	exitCode,
	formatReport,
	summarize,
	toCheckResult,
	withRetry,
} from "./report.ts";

const results: CheckResult[] = [
	{ name: "web", status: "ok", detail: "200" },
	{ name: "ws", status: "failed", detail: "つながらない" },
	{ name: "assets", status: "skipped", detail: "未設定" },
];

describe("summarize / exitCode（issue-50）", () => {
	it("ok / failed / skipped に分け、failed があれば ok は false", () => {
		const s = summarize(results);
		expect(s.passed.map((r) => r.name)).toEqual(["web"]);
		expect(s.failed.map((r) => r.name)).toEqual(["ws"]);
		expect(s.skipped.map((r) => r.name)).toEqual(["assets"]);
		expect(s.ok).toBe(false);
	});

	it("失敗が1つでもあれば終了コード 1、無ければ 0。skipped は失敗にしない", () => {
		expect(exitCode(results)).toBe(1);
		expect(
			exitCode([
				{ name: "web", status: "ok", detail: "" },
				{ name: "assets", status: "skipped", detail: "" },
			]),
		).toBe(0);
		expect(exitCode([])).toBe(0);
	});
});

describe("withRetry（issue-50）", () => {
	const noSleep = () => Promise.resolve();

	it("ok になったらそこで止め、待ちは失敗の後だけに入る", async () => {
		let calls = 0;
		const sleeps: number[] = [];
		const result = await withRetry(
			async () => {
				calls += 1;
				return { ok: calls === 3, detail: `try ${calls}` };
			},
			{
				retries: 5,
				intervalMs: 10,
				sleep: (ms) => {
					sleeps.push(ms);
					return Promise.resolve();
				},
			},
		);
		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(3);
		expect(calls).toBe(3);
		// 1回目・2回目の失敗の後に待ち、3回目の成功の後は待たない。
		expect(sleeps).toEqual([10, 10]);
	});

	it("ずっと失敗なら、最初の1回 + retries 回だけ試し、最後の結果を返す", async () => {
		let calls = 0;
		const result = await withRetry(
			async () => {
				calls += 1;
				return { ok: false, detail: `try ${calls}` };
			},
			{ retries: 2, intervalMs: 0, sleep: noSleep },
		);
		expect(calls).toBe(3);
		expect(result.attempts).toBe(3);
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("try 3");
	});

	it("retries が 0 でも、最低1回は試す", async () => {
		let calls = 0;
		await withRetry(
			async () => {
				calls += 1;
				return { ok: false, detail: "" };
			},
			{ retries: 0, intervalMs: 0, sleep: noSleep },
		);
		expect(calls).toBe(1);
	});
});

describe("formatReport（issue-50）", () => {
	it("日付・対象・各項目・集計を出す", () => {
		const text = formatReport(
			results,
			"https://example.test",
			new Date("2026-10-10T00:00:00Z"),
		);
		expect(text).toContain("2026-10-10T00:00:00.000Z");
		expect(text).toContain("対象 https://example.test");
		expect(text).toContain("[OK  ] web: 200");
		expect(text).toContain("[FAIL] ws: つながらない");
		expect(text).toContain("[SKIP] assets: 未設定");
		expect(text).toContain("結果: 失敗（成功 1 / 失敗 1 / 省略 1）");
	});
});

describe("toCheckResult（issue-50）", () => {
	it("ok なら ok、だめなら failed。2回以上試したときだけ回数を添える", () => {
		expect(
			toCheckResult("web", { ok: true, detail: "200", attempts: 1 }),
		).toEqual({ name: "web", status: "ok", detail: "200" });
		expect(
			toCheckResult("ws", { ok: false, detail: "つながらない", attempts: 4 }),
		).toEqual({
			name: "ws",
			status: "failed",
			detail: "つながらない（4回試行）",
		});
	});
});
