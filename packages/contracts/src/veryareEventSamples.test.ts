import { describe, expect, it } from "vitest";
import fixture from "./fixtures/veryare-events.json";
import movement from "./fixtures/veryare-movement.json";
import stageFixture from "./fixtures/veryare-stage.json";
import { shootEventSamples, stageNoticeSamples } from "./veryareEventSamples";

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

describe("veryare のステージの通知の見本（issue-29a / ADR 0009）", () => {
	it("ステージの通知の JSON の見本（valid）は、TS の型で書いた見本と一致する", () => {
		expect(stageFixture.valid).toEqual(
			JSON.parse(JSON.stringify(stageNoticeSamples)),
		);
	});

	it("拒むべき見本（invalid）がある（Gleam の decoder がすべて拒むことを確かめる）", () => {
		expect(stageFixture.invalid.length).toBeGreaterThan(0);
	});

	it("移動の規則の共有の見本の地図は、ステージの通知の見本（1つ目）と同じ", () => {
		expect(movement.stage).toEqual(stageFixture.valid[0]);
		expect(movement.cases.length).toBeGreaterThan(0);
	});
});
