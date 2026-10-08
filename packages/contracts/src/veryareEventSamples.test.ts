import { describe, expect, it } from "vitest";
import fixture from "./fixtures/veryare-events.json";
import { shootEventSamples } from "./veryareEventSamples";

describe("veryare のイベントの見本（TS の型・JSON・Gleam の対応 / ADR 0009）", () => {
	it("射撃の申告の JSON の見本（valid）は、TS の型で書いた見本と一致する", () => {
		expect(fixture.shoot.valid).toEqual(
			JSON.parse(JSON.stringify(shootEventSamples)),
		);
	});

	it("拒むべき見本（invalid）は、TS の型にも合わない形になっている", () => {
		for (const sample of fixture.shoot.invalid) {
			const value = sample as Record<string, unknown>;
			const target = value.target;
			const fitsType =
				value.type === "shoot" &&
				"target" in value &&
				(typeof target === "string" || target === null);
			expect(fitsType).toBe(false);
		}
	});
});
