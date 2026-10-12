import { describe, expect, it } from "vitest";
import fixture from "./fixtures/veryare-events.json";
import movement from "./fixtures/veryare-movement.json";
import paintFixture from "./fixtures/veryare-paint.json";
import posesFixture from "./fixtures/veryare-poses.json";
import stageFixture from "./fixtures/veryare-stage.json";
import {
	VERYARE_CPU_POSES,
	VERYARE_MODEL_POSES,
	VERYARE_PAINT_LIMITS,
	VERYARE_PAINT_PARTS,
} from "./veryare";
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

describe("veryare のポーズの見本（issue-56 / ADR 0009）", () => {
	it("素材のポーズの識別子は、共有の見本（veryare-poses.json）と同じ順・同じ 23 個", () => {
		expect(posesFixture.poses.map((p) => p.id)).toEqual([
			...VERYARE_MODEL_POSES,
		]);
		expect(VERYARE_MODEL_POSES).toHaveLength(23);
		for (const id of VERYARE_MODEL_POSES) expect(id).toMatch(/^[A-Za-z0-9]+$/);
	});

	it("CPU と鬼のポーズの値は、見本の対応（cpu）の鍵と同じで、対応先と既定は一覧の中", () => {
		expect(Object.keys(posesFixture.cpu)).toEqual([...VERYARE_CPU_POSES]);
		const ids = new Set<string>(VERYARE_MODEL_POSES);
		for (const target of Object.values(posesFixture.cpu)) {
			expect(ids.has(target)).toBe(true);
		}
		expect(ids.has(posesFixture.default)).toBe(true);
	});

	it("ペイントの確定の見本: ポーズだけの確定と、ペイントとポーズの確定がある。両方 null は拒む見本", () => {
		expect(
			paintFixture.valid.some((e) => e.paint === null && "pose" in e),
		).toBe(true);
		expect(paintFixture.invalid).toContainEqual({
			type: "paint",
			paint: null,
			pose: null,
		});
	});

	it("ペイントの部位（issue-54）: 受け付ける見本は5部位をすべて使い、一覧に無い部位は拒む見本", () => {
		const parts = new Set(
			paintFixture.valid.flatMap((e) =>
				e.paint === null ? [] : e.paint.strokes.map((s) => s.part),
			),
		);
		expect([...parts].sort()).toEqual([...VERYARE_PAINT_PARTS].sort());
		const known = new Set<string>(VERYARE_PAINT_PARTS);
		expect(
			paintFixture.invalid.some(
				(e) =>
					e.paint != null &&
					"strokes" in e.paint &&
					e.paint.strokes.some((s) => !known.has(s.part)),
			),
		).toBe(true);
	});
});
