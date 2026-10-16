import { describe, expect, it } from "vitest";
import { PAINT_LOCK_MS, shouldSubmitPaint } from "./paint";
import {
	NO_PHASE_CLOCK,
	type PhaseClock,
	receivePhase,
	remainingOf,
} from "./phaseClock";
import type { PhaseNotice } from "./rules";

const painting = (durationMs: number | null): PhaseNotice => ({
	phase: "painting",
	durationMs,
	oni: "a",
	outcome: null,
	area: null,
});

describe("receivePhase・remainingOf - フェーズの通知の長さは、通知を作った時点からの残り（ADR 0046）", () => {
	it("フェーズの開始の通知（長さ = フェーズの長さ）から、受け取ってからの経過を引いた残り", () => {
		const clock = receivePhase(NO_PHASE_CLOCK, painting(20_000), 1000);
		expect(remainingOf(clock, 1000)).toBe(20_000);
		expect(remainingOf(clock, 6000)).toBe(15_000);
	});

	it("残りの違う同じフェーズの通知（復帰の送り直し）が届くと、残り時間を、届いた値に合わせ直す", () => {
		// 画面ロックの間に時計が止まり、手元では、まだ 15 秒残っているように見えている。
		const before = receivePhase(NO_PHASE_CLOCK, painting(20_000), 1000);
		expect(remainingOf(before, 6000)).toBe(15_000);
		// 復帰で、サーバーの残り 4 秒が届く。
		const after = receivePhase(before, painting(4000), 6000);
		expect(after).not.toBe(before);
		expect(remainingOf(after, 6000)).toBe(4000);
		expect(remainingOf(after, 7000)).toBe(3000);
	});

	it("中身の同じ通知（長さも同じ）は、無視する（受け取った時刻を変えない）", () => {
		const first = receivePhase(NO_PHASE_CLOCK, painting(20_000), 1000);
		const again = receivePhase(first, painting(20_000), 9000);
		expect(again).toBe(first);
		expect(remainingOf(again, 9000)).toBe(12_000);
	});

	it("長さを持たない通知（鬼選出など）と、通知がまだ無いときは、残りは無限", () => {
		expect(remainingOf(NO_PHASE_CLOCK, 0)).toBe(Number.POSITIVE_INFINITY);
		const selection = receivePhase(
			NO_PHASE_CLOCK,
			{
				phase: "oni-selection",
				durationMs: null,
				oni: null,
				outcome: null,
				area: "ready",
			},
			0,
		);
		expect(remainingOf(selection, 99_999)).toBe(Number.POSITIVE_INFINITY);
	});

	it("受け取る前の時刻で数えても、届いた値を超えない", () => {
		const clock = receivePhase(NO_PHASE_CLOCK, painting(1900), 3100);
		expect(remainingOf(clock, 2860)).toBe(1900);
	});

	it("残りは 0 未満にならない", () => {
		const clock = receivePhase(NO_PHASE_CLOCK, painting(1000), 0);
		expect(remainingOf(clock, 5000)).toBe(0);
	});
});

describe("塗りの自動確定が、送り直しの残りに合わせて動く", () => {
	const submitAt = (clock: PhaseClock, now: number) =>
		shouldSubmitPaint({
			phase: "painting",
			remainingMs: remainingOf(clock, now),
			submitted: false,
			confirmed: false,
			strokeCount: 1,
			poseChosen: false,
		});

	it("復帰で残り 5 秒が届くと、そこから 3 秒後（残り 2 秒）に送る。フェーズの長さのまま数えると、送り損ねる", () => {
		const resumed = receivePhase(NO_PHASE_CLOCK, painting(5000), 10_000);
		expect(submitAt(resumed, 10_000 + 2999)).toBe(false);
		expect(submitAt(resumed, 10_000 + 5000 - PAINT_LOCK_MS)).toBe(true);
		// 前の意味（長さ = フェーズの長さ 20 秒）のまま数えると、同じ時刻には、まだ送らない。
		const stale = receivePhase(NO_PHASE_CLOCK, painting(20_000), 10_000);
		expect(submitAt(stale, 10_000 + 5000 - PAINT_LOCK_MS)).toBe(false);
	});
});
