import { describe, expect, it } from "vitest";
import {
	BALL_R,
	CELL,
	LEVELS,
	type Level,
	STAGE_SOURCES,
	TOTAL_LEVELS,
	atGoal,
	createRun,
	levelAt,
	startBall,
	stepBall,
} from "./engine";

/** start マスからゴールマスへ、開いたマスを辿って到達できるか（連結性）。 */
function goalReachable(level: Level): boolean {
	const seen = new Set<string>();
	const stack: [number, number][] = [[1, 1]];
	while (stack.length > 0) {
		const cell = stack.pop();
		if (cell === undefined) break;
		const [gx, gy] = cell;
		const key = `${gx},${gy}`;
		if (seen.has(key)) continue;
		if (gx < 0 || gx >= level.gridCols || gy < 0 || gy >= level.gridRows) {
			continue;
		}
		if (level.grid[gy]?.[gx]) continue; // 壁
		seen.add(key);
		if (gx === level.goalCell.gx && gy === level.goalCell.gy) return true;
		stack.push([gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]);
	}
	return false;
}

/** start マスからゴールマスまでの最短の歩数（グリッドのマス単位）。 */
function shortestPath(level: Level): number {
	const queue: [number, number, number][] = [[1, 1, 0]];
	const seen = new Set(["1,1"]);
	while (queue.length > 0) {
		const next = queue.shift();
		if (next === undefined) break;
		const [gx, gy, steps] = next;
		if (gx === level.goalCell.gx && gy === level.goalCell.gy) return steps;
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const) {
			const key = `${gx + dx},${gy + dy}`;
			if (seen.has(key) || (level.grid[gy + dy]?.[gx + dx] ?? true)) continue;
			seen.add(key);
			queue.push([gx + dx, gy + dy, steps + 1]);
		}
	}
	return -1;
}

describe("迷路の構造", () => {
	it("3 面ある（易・中・難）", () => {
		expect(TOTAL_LEVELS).toBe(3);
		expect(LEVELS).toHaveLength(TOTAL_LEVELS);
	});

	it("旧10面のうち 1・5・10 面を、同じ形のまま使う", () => {
		expect(STAGE_SOURCES).toEqual([1, 5, 10]);
		// 旧面の大きさ（4x4 / 6x6 / 7x7）がそのまま残る。
		expect(LEVELS.map((level) => (level.gridCols - 1) / 2)).toEqual([4, 6, 7]);
	});

	it("易・中・難の順に、ゴールまでの最短経路が長くなる", () => {
		const lengths = LEVELS.map(shortestPath);
		expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
		expect(new Set(lengths).size).toBe(3);
	});

	it("各面は外周が壁で、開始とゴールのマスは開いている", () => {
		for (const level of LEVELS) {
			expect(level.grid[0]?.every((cell) => cell)).toBe(true);
			expect(level.grid[level.gridRows - 1]?.every((cell) => cell)).toBe(true);
			// 開始マス(1,1) とゴールマスは通行可能。
			expect(level.grid[1]?.[1]).toBe(false);
			expect(level.grid[level.goalCell.gy]?.[level.goalCell.gx]).toBe(false);
		}
	});

	it("各面はゴールまで到達できる（連結している）", () => {
		for (const level of LEVELS) {
			expect(goalReachable(level)).toBe(true);
		}
	});
});

describe("球の物理", () => {
	it("外周の壁をすり抜けない（上方向）", () => {
		const level = levelAt(0);
		let ball = startBall(level);
		for (let i = 0; i < 120; i++) {
			ball = stepBall(level, ball, { x: 0, y: -1 }, 1 / 60);
		}
		// 最上段の開き行は grid 行 1。球の上端が壁行 0 に食い込まない。
		expect(ball.y).toBeGreaterThanOrEqual(CELL - BALL_R);
		expect(Math.floor((ball.y - BALL_R) / CELL)).toBeGreaterThanOrEqual(1);
	});

	it("入力がなければ止まっていく", () => {
		const level = levelAt(0);
		let ball = { ...startBall(level), vx: 100, vy: 0 };
		for (let i = 0; i < 300; i++) {
			ball = stepBall(level, ball, { x: 0, y: 0 }, 1 / 60);
		}
		expect(Math.abs(ball.vx)).toBeLessThan(5);
	});
});

describe("ゴール判定", () => {
	it("ゴールマスにいれば到達、開始位置では未到達", () => {
		const level = levelAt(0);
		expect(atGoal(level, startBall(level))).toBe(false);
		expect(
			atGoal(level, { x: level.goal.x, y: level.goal.y, vx: 0, vy: 0 }),
		).toBe(true);
	});
});

describe("createRun", () => {
	it("0 面・未クリアで始まる", () => {
		const run = createRun();
		expect(run.levelIndex).toBe(0);
		expect(run.cleared).toBe(false);
	});
});
