import { describe, expect, it } from "vitest";
import {
	BALL_R,
	CELL,
	DIFFICULTIES,
	MAZE_CELLS,
	atGoal,
	cellOfBall,
	createLevel,
	startBall,
	stepBall,
} from "./engine";
import { shortestPath } from "./maze";

describe("難易度と迷路", () => {
	it("難易度は小・中・大の3つで、5×5 / 8×8 / 11×11 マス", () => {
		expect(DIFFICULTIES).toEqual(["small", "medium", "large"]);
		expect(DIFFICULTIES.map((d) => MAZE_CELLS[d])).toEqual([5, 8, 11]);
		for (const difficulty of DIFFICULTIES) {
			const level = createLevel(difficulty, 1);
			const cells = MAZE_CELLS[difficulty];
			expect(level.cells).toBe(cells);
			expect(level.gridCols).toBe(2 * cells + 1);
			expect(level.widthPx).toBe((2 * cells + 1) * CELL);
		}
	});

	it("スタートは左上、ゴールは右下のマスで、どちらも通路", () => {
		const level = createLevel("medium", 5);
		expect(level.startCell).toEqual({ cx: 0, cy: 0 });
		expect(level.goalMazeCell).toEqual({ cx: 7, cy: 7 });
		expect(level.goalCell).toEqual({ gx: 15, gy: 15 });
		expect(level.grid[1]?.[1]).toBe(false);
		expect(level.grid[15]?.[15]).toBe(false);
	});

	it("同じ難易度と seed なら同じ迷路、seed が違えば違う迷路", () => {
		expect(createLevel("large", 9).grid).toEqual(createLevel("large", 9).grid);
		expect(createLevel("large", 9).grid).not.toEqual(
			createLevel("large", 10).grid,
		);
	});

	it("どの難易度・seed でも、ゴールまで着ける", () => {
		for (const difficulty of DIFFICULTIES) {
			for (let seed = 1; seed <= 10; seed++) {
				const level = createLevel(difficulty, seed);
				expect(
					shortestPath(level.grid, level.startCell, level.goalMazeCell),
				).not.toBeNull();
			}
		}
	});
});

describe("cellOfBall - 球がいるマス", () => {
	it("マスの上ならそのマス、マスどうしの間の通路の上なら null", () => {
		const level = createLevel("small", 1);
		expect(cellOfBall(startBall(level))).toEqual({ cx: 0, cy: 0 });
		expect(cellOfBall({ x: 3.5 * CELL, y: 1.5 * CELL, vx: 0, vy: 0 })).toEqual({
			cx: 1,
			cy: 0,
		});
		expect(
			cellOfBall({ x: 2.5 * CELL, y: 1.5 * CELL, vx: 0, vy: 0 }),
		).toBeNull();
	});
});

describe("球の物理", () => {
	it("外周の壁をすり抜けない（上方向）", () => {
		const level = createLevel("small", 1);
		let ball = startBall(level);
		for (let i = 0; i < 120; i++) {
			ball = stepBall(level, ball, { x: 0, y: -1 }, 1 / 60);
		}
		// 最上段の開き行は grid 行 1。球の上端が壁行 0 に食い込まない。
		expect(ball.y).toBeGreaterThanOrEqual(CELL - BALL_R);
		expect(Math.floor((ball.y - BALL_R) / CELL)).toBeGreaterThanOrEqual(1);
	});

	it("入力がなければ止まっていく", () => {
		const level = createLevel("small", 1);
		let ball = { ...startBall(level), vx: 100, vy: 0 };
		for (let i = 0; i < 300; i++) {
			ball = stepBall(level, ball, { x: 0, y: 0 }, 1 / 60);
		}
		expect(Math.abs(ball.vx)).toBeLessThan(5);
	});
});

describe("ゴール判定", () => {
	it("ゴールマスにいれば到達、開始位置では未到達", () => {
		const level = createLevel("small", 1);
		expect(atGoal(level, startBall(level))).toBe(false);
		expect(
			atGoal(level, { x: level.goal.x, y: level.goal.y, vx: 0, vy: 0 }),
		).toBe(true);
	});
});
