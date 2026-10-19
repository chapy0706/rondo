/**
 * 広い屋敷の契約の見本（veryare-skeleton-stages.json の wideStages / issue-65）を、画面の移動の規則
 * （stage.ts）で読む。サーバーの側は、stage_notice_test が、同じ見本とサーバーの地図の一致を確かめる。
 * 広い屋敷は、ルーム作成の stage 2（おまかせ。旗 wide_ready が立つまでは 10 種だけ）と 3（広い屋敷だけ。
 * サーバーを RONDO_WIDE_DEV=1 で動かすときだけ）で出る。ロビーの選択肢は、まだ 0・1 のまま。
 */
import { describe, expect, it } from "vitest";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { WALK_SPEED, farthestWalk } from "./motion";
import {
	type Cell,
	type StageGrid,
	cellAt,
	parseStageNotice,
	passable,
} from "./stage";

/** 始まりの案内で、広い屋敷かを見分ける幅（server の skeleton_check.gleam の wide_min_width）。 */
const WIDE_MIN_WIDTH = 20;

const wide = skeletons.wideStages.map((notice, i) => {
	const stage = parseStageNotice(notice);
	if (stage === null) throw new Error(`広い屋敷 ${i + 1} が読めない`);
	return [i + 1, stage, notice] as const;
});

/** 襖を全部開けた（準備移動の）道で、玄関から歩いて着けるマス。 */
function reachable(stage: StageGrid): Set<string> {
	const open = new Set(stage.doors.keys());
	const start = cellAt(stage, stage.spawn);
	const key = (c: Cell) => `${c.x},${c.z}`;
	const seen = new Set([key(start)]);
	const queue: Cell[] = [start];
	for (let i = 0; i < queue.length; i++) {
		const here = queue[i] as Cell;
		for (const [dx, dz] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const) {
			const next = { x: here.x + dx, z: here.z + dz };
			if (seen.has(key(next)) || !passable(stage, open, here, next)) continue;
			seen.add(key(next));
			queue.push(next);
		}
	}
	return seen;
}

describe("広い屋敷の見本（issue-65）を、画面の移動の規則で読む", () => {
	it("見本は 3 種。既存の 10 種の見本（stages）は、そのまま", () => {
		expect(skeletons.wideStages).toHaveLength(3);
		expect(skeletons.stages).toHaveLength(10);
	});

	it.each(wide)(
		"広い屋敷 %i: 玄関は歩けるマスで、襖を開ければ、すべての部屋に入れる",
		(_n, stage, notice) => {
			expect(stage.regionAt(cellAt(stage, stage.spawn))).toBe("open");
			const seen = reachable(stage);
			for (const door of notice.doors) {
				expect(seen.has(`${door.a.x},${door.a.z}`), JSON.stringify(door)).toBe(
					true,
				);
				expect(seen.has(`${door.b.x},${door.b.z}`), JSON.stringify(door)).toBe(
					true,
				);
			}
			// 部屋の数（全スロットに割り当てた見本）は、検算の範囲（46〜52）。
			expect(Object.keys(notice.rooms).length).toBeGreaterThanOrEqual(46);
			expect(Object.keys(notice.rooms).length).toBeLessThanOrEqual(52);
		},
	);

	it.each(wide)(
		"広い屋敷 %i: 襖が閉じていれば、部屋に入れない",
		(_n, stage, notice) => {
			const door = notice.doors[0];
			if (door === undefined) throw new Error("襖が無い");
			expect(passable(stage, new Set(), door.a, door.b)).toBe(false);
		},
	);

	it.each(wide)(
		"広い屋敷 %i: いちばん遠いマスまで、準備移動の上限（50 秒）のうちに歩ける",
		(_n, stage) => {
			expect(farthestWalk(stage) / WALK_SPEED + 5).toBeLessThanOrEqual(50);
		},
	);

	it("ステージの通知の幅で見分けられる: 10 種の最大の幅 < 20 m ≤ 広い屋敷の最小の幅", () => {
		const normalMax = Math.max(...skeletons.stages.map((s) => s.width));
		const wideMin = Math.min(...skeletons.wideStages.map((s) => s.width));
		expect(normalMax).toBeLessThan(WIDE_MIN_WIDTH);
		expect(wideMin).toBeGreaterThanOrEqual(WIDE_MIN_WIDTH);
	});
});
