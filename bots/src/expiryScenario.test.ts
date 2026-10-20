/**
 * 結果のあと、ルームが閉じるシナリオ（issue-70）の宣言と、確かめ（サーバーなしで見る）。
 * 既存のシナリオ（scenarios.test.ts・wideScenarios.test.ts）は変えず、別の配列（expiryScenarios）に置く。
 */
import type { ServerMessage } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { checkExpiry } from "./expect.ts";
import { allScenarios, expiryScenarios } from "./scenarios.ts";
import { SERVER_DEFAULTS, scaled } from "./timing.ts";

const ended = (closesInMs?: number): ServerMessage => ({
	type: "game-ended",
	gameType: "veryare",
	roomId: "room-1",
	result: { order: "higher-is-better", rankings: [] },
	...(closesInMs === undefined ? {} : { closesInMs }),
});

describe("expiryScenarios - 宣言", () => {
	it("時間切れで結果まで進め、結果のあと、ルームが閉じるまで待つ 1 つ", () => {
		expect(expiryScenarios.map((s) => s.name)).toEqual([
			"結果のあと、ルームが閉じる",
		]);
		for (const s of expiryScenarios) {
			expect(s.expiry).toBe(true);
			expect(s.receivers.length).toBeGreaterThan(0);
		}
		// 既存のシナリオは、閉じるまで待たない（make bots の時間を延ばさない）。
		for (const s of allScenarios) expect(s.expiry ?? false).toBe(false);
	});

	it("閉じるまでの時間は 3 分。make bots の短縮（1/20）で 9 秒", () => {
		expect(SERVER_DEFAULTS.finishedCloseMs).toBe(180_000);
		expect(scaled(SERVER_DEFAULTS.finishedCloseMs)).toBe(9000);
	});
});

describe("checkExpiry - 結果に閉じるまでの残りが載り、時間がたつと全員に room-expired が届く", () => {
	it("全員に、残りつきの結果と room-expired が届けば、問題なし", () => {
		expect(
			checkExpiry(9000, [
				{ name: "bot-a", ended: ended(9000), expired: true },
				{ name: "bot-b", ended: ended(9000), expired: true },
			]),
		).toEqual([]);
	});

	it("残りが無い・違う、結果が届かない、room-expired が届かない、を問題にする", () => {
		expect(
			checkExpiry(9000, [
				{ name: "bot-a", ended: ended(), expired: true },
				{ name: "bot-b", ended: ended(8000), expired: true },
				{ name: "bot-c", ended: undefined, expired: true },
				{ name: "bot-d", ended: ended(9000), expired: false },
			]),
		).toEqual([
			"bot-a: 結果の閉じるまでの残りが なし（9000 ms のはず）",
			"bot-b: 結果の閉じるまでの残りが 8000（9000 ms のはず）",
			"bot-c: 結果が届かない",
			"bot-d: room-expired が届かない",
		]);
	});
});
