import { describe, expect, it } from "vitest";
import hirayaFixture from "../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import skeletons from "../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import stageFixture from "../../packages/contracts/src/fixtures/veryare-stage.json";
import {
	type Cell,
	HIDER_GAP,
	cellOf,
	findPath,
	pickDoorShot,
	regionAt,
} from "./plan.ts";
import { MIN_GAP, readStageNotice } from "./stage.ts";

const tiny = readStageNotice(stageFixture.valid[0]);
if (tiny === null) throw new Error("見本が読めない");

const isStep = (a: Cell, b: Cell) =>
	Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;

describe("findPath - 通れる境だけをたどる幅優先探索（issue-29b）", () => {
	it("同じ領域の中は、1マスずつ隣へ進む最短の道", () => {
		const path = findPath(tiny, { x: 0, z: 4 }, { x: 1, z: 0 }, "closed");
		expect(path?.at(0)).toEqual({ x: 0, z: 4 });
		expect(path?.at(-1)).toEqual({ x: 1, z: 0 });
		// 最短（マンハッタン距離 5 → 6マス）。
		expect(path).toHaveLength(6);
		path?.slice(1).forEach((cell, i) => {
			expect(isStep(path[i] as Cell, cell)).toBe(true);
		});
	});

	it("襖は、開いている扱いのときだけ通る。いつも開いている戸は、いつも通る", () => {
		expect(findPath(tiny, { x: 1, z: 1 }, { x: 2, z: 1 }, "closed")).toBeNull();
		expect(findPath(tiny, { x: 1, z: 1 }, { x: 2, z: 1 }, "open")).toEqual([
			{ x: 1, z: 1 },
			{ x: 2, z: 1 },
		]);
		expect(findPath(tiny, { x: 1, z: 3 }, { x: 2, z: 3 }, "closed")).toEqual([
			{ x: 1, z: 3 },
			{ x: 2, z: 3 },
		]);
	});

	it("壁・いつも閉じている戸・歩けないマスは通らない（着けなければ null）", () => {
		// 部屋 A の向こうの廊下 (4,2) へは、襖を2つ通らないと着かない。
		expect(findPath(tiny, { x: 0, z: 0 }, { x: 4, z: 2 }, "closed")).toBeNull();
		expect(
			findPath(tiny, { x: 0, z: 0 }, { x: 4, z: 2 }, "open")?.at(-1),
		).toEqual({ x: 4, z: 2 });
		expect(findPath(tiny, { x: 1, z: 4 }, { x: 2, z: 4 }, "open")).toBeNull();
	});
});

describe("pickDoorShot - 壁越し・襖越しに撃つためのマス（issue-29b）", () => {
	it("小さな屋敷では、部屋 A の襖 (1,1)-(2,1) と、壁 (1,0)-(2,0) を選ぶ", () => {
		expect(pickDoorShot(tiny)).toEqual({
			room: "A",
			door: { a: { x: 1, z: 1 }, b: { x: 2, z: 1 } },
			c: { x: 1, z: 1 },
			s: { x: 2, z: 1 },
			r: { x: 2, z: 0 },
			w: { x: 1, z: 0 },
		});
	});

	it.each(skeletons.stages.map((notice, i) => [i + 1, notice] as const))(
		"骨格%i: 条件を満たすマスが見つかる",
		(_id, notice) => {
			const stage = readStageNotice(notice);
			if (stage === null) throw new Error("読めない");
			const plan = pickDoorShot(stage);
			if (plan === null) throw new Error("見つからない");
			const { c, s, r, w, door, room } = plan;
			// c は廊下、s・r は部屋 room、w は廊下。
			expect(regionAt(stage, c)).toBe("open");
			expect(regionAt(stage, w)).toBe("open");
			expect(regionAt(stage, s)).toBe(room);
			expect(regionAt(stage, r)).toBe(room);
			expect(r).not.toEqual(s);
			// c と s の境は襖。w と r は隣り合い、その境は戸の一覧に無い（壁）。
			expect(isStep(c, s) && isStep(w, r)).toBe(true);
			expect([door.a, door.b]).toContainEqual(c);
			expect([door.a, door.b]).toContainEqual(s);
			const key = (a: Cell, b: Cell) => {
				const [p, q] =
					a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
				return `${p.x},${p.z}|${q.x},${q.z}`;
			};
			expect(stage.doors.get(key(c, s))).toBe("fusuma");
			expect(stage.doors.has(key(w, r))).toBe(false);
			// 玄関から、隠れ側は襖を開けたまま s・r へ、鬼は襖を閉じたまま c・w へ着ける。
			const spawn = cellOf(stage, stage.spawn);
			expect(findPath(stage, spawn, s, "open")).not.toBeNull();
			expect(findPath(stage, spawn, r, "open")).not.toBeNull();
			expect(findPath(stage, spawn, c, "closed")).not.toBeNull();
			expect(findPath(stage, spawn, w, "closed")).not.toBeNull();
		},
	);
});

describe("pickDoorShot - 平屋（issue-45。廊下という領域が無く、部屋どうしが戸でつながる）", () => {
	const stage = readStageNotice(hirayaFixture.stage);
	if (stage === null) throw new Error("平屋の見本が読めない");
	const key = (a: Cell, b: Cell) => {
		const [p, q] = a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
		return `${p.x},${p.z}|${q.x},${q.z}`;
	};

	it("和室C と東の廊下の襖、和室C の北東の隅の壁を選ぶ", () => {
		const plan = pickDoorShot(stage);
		if (plan === null) throw new Error("見つからない");
		expect(plan.room).toBe("C");
		expect(regionAt(stage, plan.c)).toBe(".");
		expect(regionAt(stage, plan.w)).toBe(".");
		expect(plan.r).toEqual({ x: 32, z: 21 });
		expect(plan.w).toEqual({ x: 33, z: 21 });
	});

	it("条件: c・w は部屋の外、s・r は部屋の中。c-s は襖、w-r は壁。玄関から着ける", () => {
		const plan = pickDoorShot(stage);
		if (plan === null) throw new Error("見つからない");
		const { c, s, r, w, room } = plan;
		expect(regionAt(stage, c)).not.toBe(room);
		expect(regionAt(stage, w)).not.toBe(room);
		expect(regionAt(stage, s)).toBe(room);
		expect(regionAt(stage, r)).toBe(room);
		expect(isStep(c, s) && isStep(w, r)).toBe(true);
		expect(stage.doors.get(key(c, s))).toBe("fusuma");
		expect(stage.doors.has(key(w, r))).toBe(false);
		const spawn = cellOf(stage, stage.spawn);
		expect(findPath(stage, spawn, s, "open")).not.toBeNull();
		expect(findPath(stage, spawn, r, "open")).not.toBeNull();
		expect(findPath(stage, spawn, c, "closed")).not.toBeNull();
		expect(findPath(stage, spawn, w, "closed")).not.toBeNull();
	});

	it("隠れ側の2人（r と s）は、被りの判定にかからない距離だけ離れている（0.3 m のマス）", () => {
		const plan = pickDoorShot(stage);
		if (plan === null) throw new Error("見つからない");
		const d =
			Math.hypot(plan.r.x - plan.s.x, plan.r.z - plan.s.z) * stage.cellSize;
		expect(d).toBeGreaterThanOrEqual(MIN_GAP);
	});

	it("離す距離は、散らばり方（stage.ts）の MIN_GAP と同じ", () => {
		expect(HIDER_GAP).toBe(MIN_GAP);
	});
});
