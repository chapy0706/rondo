import { describe, expect, it } from "vitest";
import {
	markdownTable,
	memorySummary,
	perSecond,
	percentile,
	summarize,
} from "./stats.ts";

describe("集計（issue-51）", () => {
	it("percentile は、小さい順の nearest-rank", () => {
		const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		expect(percentile(sorted, 50)).toBe(5);
		expect(percentile(sorted, 95)).toBe(10);
		expect(percentile(sorted, 0)).toBe(1);
		expect(percentile([7], 95)).toBe(7);
	});

	it("summarize は、件数・最小・中央・95%・最大・平均。空なら null", () => {
		expect(summarize([5, 1, 3])).toEqual({
			count: 3,
			min: 1,
			p50: 3,
			p95: 5,
			max: 5,
			mean: 3,
		});
		expect(summarize([])).toBeNull();
	});

	it("perSecond は、件数を秒あたりに直す（0 秒なら 0）", () => {
		expect(perSecond(30, 3000)).toBe(10);
		expect(perSecond(5, 0)).toBe(0);
	});

	it("memorySummary は、始め・終わり・最大（MiB）と、1時間あたりの増え方（最小二乗の傾き）、CPU の平均・最大", () => {
		const samples = [0, 1, 2, 3].map((minute) => ({
			at: minute * 60_000,
			rssKb: (100 + minute) * 1024,
			cpu: minute * 10,
		}));
		expect(memorySummary(samples)).toEqual({
			startMb: 100,
			endMb: 103,
			maxMb: 103,
			growthMbPerHour: 60,
			cpuMean: 15,
			cpuMax: 30,
		});
		expect(memorySummary([])).toBeNull();
		// 1点だけなら、増え方は 0。
		expect(
			memorySummary([{ at: 0, rssKb: 2048, cpu: 1 }])?.growthMbPerHour,
		).toBe(0);
	});

	it("markdownTable は、見出しと行を Markdown の表にする", () => {
		expect(markdownTable(["項目", "値"], [["a", "1"]])).toBe(
			"| 項目 | 値 |\n| --- | --- |\n| a | 1 |",
		);
	});
});
