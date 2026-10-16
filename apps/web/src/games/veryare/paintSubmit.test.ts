/**
 * 塗りの自動確定と、フェーズの通知の送り直し（ADR 0046）。画面（Veryare.tsx）の送る判断
 * （submitPaintNow）を、通知の並びと時刻の進みで回し、確定の電文を送った回数を数える。
 */
import { describe, expect, it } from "vitest";
import { PAINT_LOCK_MS, submitPaintNow } from "./paint";
import {
	NO_PHASE_CLOCK,
	type PhaseClock,
	receivePhase,
	remainingOf,
} from "./phaseClock";
import type { PhaseNotice } from "./rules";

const painting = (durationMs: number): PhaseNotice => ({
	phase: "painting",
	durationMs,
	oni: "a",
	outcome: null,
	area: null,
});

type Event =
	| { readonly at: number; readonly notice: PhaseNotice }
	| { readonly at: number; readonly confirm: true }
	| { readonly at: number; readonly tick: true };

/**
 * 画面の動き: 通知を受け取り（receivePhase）、時刻 now で残りを数え、描き直しのたびに送る判断をする。
 * now は、描き直しの時刻（残り時間の表示の更新は 250 ms ごとなので、受け取った直後の描き直しでは、
 * 受け取る前の時刻のことがある）。送った時刻の一覧を返す。
 */
function run(events: readonly Event[], options: { lag?: number } = {}) {
	let clock: PhaseClock = NO_PHASE_CLOCK;
	let sent = false;
	let confirmed = false;
	const sentAt: number[] = [];
	for (const event of events) {
		if ("notice" in event) clock = receivePhase(clock, event.notice, event.at);
		if ("confirm" in event) confirmed = true;
		const now = event.at - ("notice" in event ? (options.lag ?? 0) : 0);
		if (
			submitPaintNow(sent, {
				phase: clock.notice?.phase ?? "oni-selection",
				remainingMs: remainingOf(clock, now),
				confirmed,
				strokeCount: 1,
				poseChosen: false,
			})
		) {
			sent = true;
			sentAt.push(event.at);
		}
	}
	return sentAt;
}

/** from から to まで、250 ms ごとの描き直し。 */
const ticks = (from: number, to: number): Event[] => {
	const out: Event[] = [];
	for (let at = from; at <= to; at += 250) out.push({ at, tick: true });
	return out;
};

describe("塗りの自動確定と、残りの違う送り直し", () => {
	it("自動で送ったあとに、残りの違う同じフェーズの通知が届いても（画面ロックからの復帰）、もう一度は送らない", () => {
		const sent = run([
			{ at: 0, notice: painting(20_000) },
			...ticks(250, 18_000),
			// 18 秒で、残り 2 秒になって送った。そのあと、復帰で残り 1.5 秒が届く。
			{ at: 18_500, notice: painting(1500) },
			...ticks(18_750, 21_000),
		]);
		expect(sent).toEqual([18_000]);
	});

	it("「塗り終わり」で送ったあとに、残りの違う通知が届いても、もう一度は送らない", () => {
		const sent = run([
			{ at: 0, notice: painting(20_000) },
			...ticks(250, 5000),
			{ at: 5100, confirm: true },
			...ticks(5250, 9000),
			{ at: 9100, notice: painting(4000) },
			{ at: 9200, notice: painting(1000) },
			...ticks(9250, 12_000),
		]);
		expect(sent).toEqual([5100]);
	});

	it("まだ送っていないときに、残りの短い通知が届いたら、残り 2 秒の時点で送る", () => {
		const sent = run([
			{ at: 0, notice: painting(20_000) },
			...ticks(250, 3000),
			// 復帰で、残り 5 秒が届く（手元では、まだ 17 秒あるように見えていた）。
			{ at: 3100, notice: painting(5000) },
			...ticks(3250, 9000),
		]);
		expect(sent).toHaveLength(1);
		const at = sent[0] as number;
		expect(at).toBeGreaterThanOrEqual(3100 + 5000 - PAINT_LOCK_MS);
		expect(at).toBeLessThan(3100 + 5000 - PAINT_LOCK_MS + 250);
	});

	it("残り 2 秒以下の通知が復帰で届いたら、届いた直後に、1 回だけ送る", () => {
		const sent = run([
			{ at: 0, notice: painting(20_000) },
			...ticks(250, 3000),
			{ at: 3100, notice: painting(1500) },
			...ticks(3250, 6000),
			// 続けて、さらに残りの違う送り直しが届いても、送らない。
			{ at: 4000, notice: painting(500) },
			...ticks(4250, 6000),
		]);
		expect(sent).toEqual([3100]);
	});

	it("受け取った直後の描き直しの時刻が、受け取る前でも（表示の更新の遅れ）、届いた直後に送る", () => {
		const sent = run(
			[
				{ at: 0, notice: painting(20_000) },
				...ticks(250, 3000),
				// 残り 1.9 秒。受け取る前の時刻（240 ms 前）で数えると 2.14 秒に見え、次の更新まで送らなかった。
				{ at: 3100, notice: painting(1900) },
			],
			{ lag: 240 },
		);
		expect(sent).toEqual([3100]);
	});

	it("残り 0 の通知（タイマーの遅れで、ペイントの終わりの直前）が届いても、届いた直後に 1 回だけ送る", () => {
		const sent = run([
			{ at: 0, notice: painting(20_000) },
			{ at: 100, notice: painting(0) },
			...ticks(250, 1000),
		]);
		expect(sent).toEqual([100]);
	});
});

describe("submitPaintNow - 送ったか（sent）を、送る判断に含める", () => {
	const input = {
		phase: "painting" as const,
		remainingMs: 1000,
		confirmed: false,
		strokeCount: 1,
		poseChosen: false,
	};

	it("送っていなければ、shouldSubmitPaint の判断どおり。送っていれば、いつも送らない", () => {
		expect(submitPaintNow(false, input)).toBe(true);
		expect(submitPaintNow(true, input)).toBe(false);
		expect(submitPaintNow(true, { ...input, confirmed: true })).toBe(false);
		expect(submitPaintNow(false, { ...input, remainingMs: 5000 })).toBe(false);
	});
});
