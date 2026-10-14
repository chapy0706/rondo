import { describe, expect, it } from "vitest";
import missedFixture from "../../../../../packages/contracts/src/fixtures/veryare-missed.json";
import {
	SIGHT_REPORT_MS,
	canReportSight,
	shouldReportSight,
	sightEvent,
} from "./sightReport";

describe("鬼の視界の報告（issue-32 / ADR 0036）", () => {
	it("探索中の鬼（観戦でない）だけが報告する", () => {
		expect(
			canReportSight({ phase: "exploration", role: "oni", spectator: false }),
		).toBe(true);
		expect(
			canReportSight({ phase: "exploration", role: "hider", spectator: false }),
		).toBe(false);
		expect(
			canReportSight({ phase: "reveal", role: "oni", spectator: false }),
		).toBe(false);
		expect(
			canReportSight({ phase: "exploration", role: "oni", spectator: true }),
		).toBe(false);
	});

	it(`${SIGHT_REPORT_MS} ms ごとに報告する（サーバーの加算の間隔と同じ）`, () => {
		expect(SIGHT_REPORT_MS).toBe(500);
		expect(shouldReportSight(1000, null)).toBe(true);
		expect(shouldReportSight(1499, 1000)).toBe(false);
		expect(shouldReportSight(1500, 1000)).toBe(true);
	});

	it("報告の電文は、契約の VeryareSightEvent の形。同じ人は1回だけ、並びは決まった順", () => {
		expect(sightEvent(["p-3", "p-2", "p-3"])).toEqual(
			missedFixture.sight.valid[1],
		);
		expect(sightEvent([])).toEqual(missedFixture.sight.valid[0]);
	});
});
