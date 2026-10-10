import { describe, expect, it } from "vitest";
import fixture from "./fixtures/veryare-events.json";
import movement from "./fixtures/veryare-movement.json";
import paintFixture from "./fixtures/veryare-paint.json";
import stageFixture from "./fixtures/veryare-stage.json";
import { VERYARE_PAINT_LIMITS } from "./veryare";
import {
	doorsNoticeSamples,
	openDoorEventSamples,
	paintEventSamples,
	shootEventSamples,
	stageNoticeSamples,
} from "./veryareEventSamples";

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

describe("veryare の襖の見本（issue-29b / ADR 0009）", () => {
	it("襖を開ける報告の JSON の見本（valid）は、TS の型で書いた見本と一致する", () => {
		expect(fixture.openDoor.valid).toEqual(
			JSON.parse(JSON.stringify(openDoorEventSamples)),
		);
		expect(fixture.openDoor.invalid.length).toBeGreaterThan(0);
	});

	it("襖の通知の JSON の見本（valid）は、TS の型で書いた見本と一致する", () => {
		expect(fixture.doorsNotice.valid).toEqual(
			JSON.parse(JSON.stringify(doorsNoticeSamples)),
		);
		expect(fixture.doorsNotice.invalid.length).toBeGreaterThan(0);
	});
});

describe("veryare のペイントの見本（issue-25 / ADR 0009）", () => {
	it("ペイントの確定の JSON の見本（valid）は、TS の型で書いた見本と一致する", () => {
		expect(paintFixture.valid).toEqual(
			JSON.parse(JSON.stringify(paintEventSamples)),
		);
		expect(paintFixture.invalid.length).toBeGreaterThan(0);
	});

	it("上限の見本（limits）は、契約の定数と同じ（サーバーの値との一致は Gleam のテストが確かめる）", () => {
		expect(paintFixture.limits).toEqual(VERYARE_PAINT_LIMITS);
	});

	it("一括配信の見本のペイントは、valid の2つ目と同じ", () => {
		expect(paintFixture.hiders.hiders[0]?.paint).toEqual(
			paintFixture.valid[1]?.paint,
		);
	});
});
