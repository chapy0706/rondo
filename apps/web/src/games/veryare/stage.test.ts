import { describe, expect, it } from "vitest";
import events from "../../../../../packages/contracts/src/fixtures/veryare-events.json";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import stageFixture from "../../../../../packages/contracts/src/fixtures/veryare-stage.json";
import type { Phase, Role, Space } from "./rules";
import {
	DOOR_REACH,
	cellAt,
	distanceToEdge,
	doorToOpen,
	edgeKey,
	mirrorMove,
	openDoorEvent,
	parseDoorsNotice,
	parseStageNotice,
	passable,
	reconcile,
	stepOnGrid,
} from "./stage";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");

const keys = (
	edges: readonly {
		a: { x: number; z: number };
		b: { x: number; z: number };
	}[],
) => new Set(edges.map((e) => edgeKey(e.a, e.b)));

const close = (
	actual: { x: number; z: number },
	expected: { x: number; z: number },
) => {
	expect(actual.x).toBeCloseTo(expected.x, 6);
	expect(actual.z).toBeCloseTo(expected.z, 6);
};

describe("parseStageNotice - ステージの通知を境で検証して読む（issue-29c）", () => {
	it("共有の見本の valid を読み、invalid を捨てる", () => {
		for (const sample of stageFixture.valid) {
			expect(parseStageNotice(sample)).not.toBeNull();
		}
		for (const sample of stageFixture.invalid) {
			expect(parseStageNotice(sample)).toBeNull();
		}
	});

	it("10種の骨格の通知も読める（玄関は歩けるマス）", () => {
		for (const sample of skeletons.stages) {
			const stage = parseStageNotice(sample);
			if (stage === null) throw new Error("読めない");
			expect(stage.regionAt(cellAt(stage, stage.spawn))).toBe("open");
		}
	});
});

describe("parseDoorsNotice - 襖の通知を読む（issue-29c）", () => {
	it("共有の見本の valid を読み、invalid を捨てる", () => {
		for (const sample of events.doorsNotice.valid) {
			expect(parseDoorsNotice(sample)).not.toBeNull();
		}
		for (const sample of events.doorsNotice.invalid) {
			expect(parseDoorsNotice(sample)).toBeNull();
		}
		expect(parseDoorsNotice(events.doorsNotice.valid[1])).toEqual(
			new Set([
				edgeKey({ x: 1, z: 1 }, { x: 2, z: 1 }),
				edgeKey({ x: 2, z: 2 }, { x: 3, z: 2 }),
			]),
		);
	});
});

describe("移動の規則（サーバーの grid.gleam の移植 / issue-29c）", () => {
	it.each(movement.cases.map((c) => [c.name, c] as const))(
		"共有の見本: %s",
		(_name, c) => {
			close(stepOnGrid(tiny, keys(c.open), c.from, c.to), c.expect);
		},
	);

	it("境は向きを問わず、同じ領域は通れ、壁は通れない", () => {
		expect(edgeKey({ x: 2, z: 1 }, { x: 1, z: 1 })).toBe(
			edgeKey({ x: 1, z: 1 }, { x: 2, z: 1 }),
		);
		expect(passable(tiny, new Set(), { x: 0, z: 0 }, { x: 1, z: 0 })).toBe(
			true,
		);
		expect(passable(tiny, new Set(), { x: 1, z: 0 }, { x: 2, z: 0 })).toBe(
			false,
		);
	});
});

describe("mirrorMove - サーバーが報告をどう扱うかを再現する（issue-29c）", () => {
	it.each(movement.moves.map((m) => [m.name, m] as const))(
		"共有の見本: %s",
		(_name, m) => {
			const result = mirrorMove({
				phase: m.phase as Phase,
				role: m.role as Role,
				space: m.space as Space,
				grid: tiny,
				open: keys(m.open),
				from: m.from,
				to: m.to,
			});
			close(result, m.expect);
		},
	);
});

describe("openDoorEvent - 襖を開ける報告", () => {
	it("共有の見本の valid と同じ形", () => {
		const sample = events.openDoor.valid[0] as {
			door: { a: { x: number; z: number }; b: { x: number; z: number } };
		};
		expect(openDoorEvent(sample.door)).toEqual(sample);
	});
});

describe("reconcile - サーバーの位置と 1 cm 以上ずれたら合わせる", () => {
	it("1 cm 未満のずれは、手元の位置のまま。1 cm 以上なら、サーバーの位置にする", () => {
		expect(reconcile({ x: 1, z: 1 }, { x: 1.009, z: 1 })).toEqual({
			x: 1,
			z: 1,
		});
		expect(reconcile({ x: 1, z: 1 }, { x: 1.011, z: 1 })).toEqual({
			x: 1.011,
			z: 1,
		});
		expect(reconcile({ x: 1, z: 1 }, { x: 1, z: 0.98 })).toEqual({
			x: 1,
			z: 0.98,
		});
	});
});

describe("distanceToEdge - 点から境までの距離（サーバーと同じ）", () => {
	it("辺の上は 0、辺に垂直に離れればその距離、辺の外は端までの距離", () => {
		const door = { a: { x: 1, z: 1 }, b: { x: 2, z: 1 } };
		expect(distanceToEdge(tiny, door, { x: 2, z: 1.5 })).toBe(0);
		expect(distanceToEdge(tiny, door, { x: 0.5, z: 1.5 })).toBe(1.5);
		expect(distanceToEdge(tiny, door, { x: 2, z: 3 })).toBe(1);
	});
});

describe("doorToOpen - 開けるボタンの対象の襖（issue-29c）", () => {
	const at = (x: number, z: number) => ({ x, z });
	const base = {
		grid: tiny,
		open: new Set<string>(),
		phase: "exploration" as Phase,
		movable: true,
		space: "stage" as Space,
	};

	it("閉じた襖の境から 1.5 m 以内なら、その襖を返す", () => {
		expect(DOOR_REACH).toBe(1.5);
		expect(doorToOpen({ ...base, position: at(0.5, 1.5) })).toEqual({
			a: { x: 1, z: 1 },
			b: { x: 2, z: 1 },
		});
		expect(doorToOpen({ ...base, position: at(0.49, 1.5) })).toBeNull();
	});

	it("いちばん近い襖を選ぶ", () => {
		// (3.5, 2.5) は、襖 (2,2)-(3,2) の境（x = 3）に 0.5 m、襖 (1,1)-(2,1) に 1.58 m。
		expect(doorToOpen({ ...base, position: at(3.5, 2.5) })).toEqual({
			a: { x: 2, z: 2 },
			b: { x: 3, z: 2 },
		});
	});

	it("開いている襖・襖でない戸には出さない", () => {
		const open = new Set([edgeKey({ x: 1, z: 1 }, { x: 2, z: 1 })]);
		expect(doorToOpen({ ...base, open, position: at(1.5, 1.5) })).toBeNull();
		// いつも開いている戸 (1,3)-(2,3)、いつも閉じている戸 (1,4)-(2,4) の近く。
		expect(doorToOpen({ ...base, position: at(1.5, 3.9) })).toBeNull();
	});

	it("動けないとき・ステージにいないとき・襖を開けられないフェーズでは出さない", () => {
		const near = at(1.5, 1.5);
		expect(doorToOpen({ ...base, position: near, movable: false })).toBeNull();
		expect(
			doorToOpen({ ...base, position: near, space: "waiting-room" }),
		).toBeNull();
		for (const phase of ["oni-selection", "reveal", "ended"] as const) {
			expect(doorToOpen({ ...base, position: near, phase })).toBeNull();
		}
		for (const phase of ["preparation", "painting", "exploration"] as const) {
			expect(doorToOpen({ ...base, position: near, phase })).not.toBeNull();
		}
	});
});
