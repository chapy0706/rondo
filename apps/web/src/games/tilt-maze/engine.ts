/**
 * rolling（内部名 tilt-maze）の純粋なクライアントロジック（ADR 0004 のリアルタイムゲーム本体）。
 *
 * 迷路と球の物理をここに閉じ込め、描画・入力・通信からは切り離す。物理は
 * クライアントで回すが、順位はサーバー受信順で確定するため（ADR 0014）、この
 * モジュールは到達判定までを担い、勝敗の決定権は持たない。
 *
 * 迷路は難易度（小・中・大）と seed から、毎回クラスカル法で作る（maze.ts / issue-39）。
 * 同じ難易度と seed なら同じ迷路になる。
 */

import { type Grid, type MazeCell, generateMaze, seededRandom } from "./maze";

/** 迷路セル 1 マスの描画・当たり判定サイズ（px）。 */
export const CELL = 24;
/** 球の半径（px）。通路幅（CELL）より十分小さくして詰まらないようにする。 */
export const BALL_R = 8;
/** 難易度。小・中・大の順。 */
export const DIFFICULTIES = ["small", "medium", "large"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** 難易度ごとの迷路のマス数（縦横同数）。 */
export const MAZE_CELLS: Readonly<Record<Difficulty, number>> = {
	small: 5,
	medium: 8,
	large: 11,
};

const ACCEL = 900;
const DAMP = 6;
const MAX_SPEED = 260;

export interface Vec {
	readonly x: number;
	readonly y: number;
}

/** 球の状態。位置と速度（px, px/s）。 */
export interface Ball {
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
}

/** 方向入力。VirtualPad の Direction と同じ最小形（[-1,1]）。 */
export interface Input {
	readonly x: number;
	readonly y: number;
}

/** 1 つの迷路。grid[gy][gx] が true なら壁。 */
export interface Level {
	readonly difficulty: Difficulty;
	readonly seed: number;
	/** 迷路のマス数（縦横同数）。 */
	readonly cells: number;
	readonly grid: Grid;
	readonly gridCols: number;
	readonly gridRows: number;
	readonly widthPx: number;
	readonly heightPx: number;
	readonly start: Vec;
	readonly goal: Vec;
	/** スタートとゴールの、迷路のマスとしての位置。 */
	readonly startCell: MazeCell;
	readonly goalMazeCell: MazeCell;
	/** ゴールの、格子としての位置（到達判定に使う）。 */
	readonly goalCell: { readonly gx: number; readonly gy: number };
}

function centerPx(gx: number, gy: number): Vec {
	return { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
}

/** 難易度と seed から迷路を作る。スタートは左上、ゴールは右下のマス。 */
export function createLevel(difficulty: Difficulty, seed: number): Level {
	const cells = MAZE_CELLS[difficulty];
	const grid = generateMaze(cells, cells, seededRandom(seed));
	const gridCols = 2 * cells + 1;
	const gridRows = 2 * cells + 1;
	const goalMazeCell = { cx: cells - 1, cy: cells - 1 };
	const goalGx = 2 * goalMazeCell.cx + 1;
	const goalGy = 2 * goalMazeCell.cy + 1;
	return {
		difficulty,
		seed,
		cells,
		grid,
		gridCols,
		gridRows,
		widthPx: gridCols * CELL,
		heightPx: gridRows * CELL,
		start: centerPx(1, 1),
		goal: centerPx(goalGx, goalGy),
		startCell: { cx: 0, cy: 0 },
		goalMazeCell,
		goalCell: { gx: goalGx, gy: goalGy },
	};
}

/**
 * 球の中心がある迷路のマス。マスどうしの間の通路（格子の偶数番目）の上なら null。
 */
export function cellOfBall(ball: Ball): MazeCell | null {
	const gx = Math.floor(ball.x / CELL);
	const gy = Math.floor(ball.y / CELL);
	if (gx % 2 === 0 || gy % 2 === 0) return null;
	return { cx: (gx - 1) / 2, cy: (gy - 1) / 2 };
}

function isWall(level: Level, gx: number, gy: number): boolean {
	if (gx < 0 || gx >= level.gridCols || gy < 0 || gy >= level.gridRows) {
		return true;
	}
	return level.grid[gy]?.[gx] ?? true;
}

/** 面の開始位置に静止した球。 */
export function startBall(level: Level): Ball {
	return { x: level.start.x, y: level.start.y, vx: 0, vy: 0 };
}

function clampSpeed(v: number): number {
	if (v > MAX_SPEED) return MAX_SPEED;
	if (v < -MAX_SPEED) return -MAX_SPEED;
	return v;
}

function collideX(
	level: Level,
	x: number,
	y: number,
	vx: number,
): {
	x: number;
	vx: number;
} {
	const top = Math.floor((y - BALL_R) / CELL);
	const bottom = Math.floor((y + BALL_R - 1e-6) / CELL);
	if (vx > 0) {
		const gx = Math.floor((x + BALL_R) / CELL);
		for (let gy = top; gy <= bottom; gy++) {
			if (isWall(level, gx, gy)) {
				return { x: gx * CELL - BALL_R - 1e-4, vx: 0 };
			}
		}
	} else if (vx < 0) {
		const gx = Math.floor((x - BALL_R) / CELL);
		for (let gy = top; gy <= bottom; gy++) {
			if (isWall(level, gx, gy)) {
				return { x: (gx + 1) * CELL + BALL_R + 1e-4, vx: 0 };
			}
		}
	}
	return { x, vx };
}

function collideY(
	level: Level,
	x: number,
	y: number,
	vy: number,
): {
	y: number;
	vy: number;
} {
	const left = Math.floor((x - BALL_R) / CELL);
	const right = Math.floor((x + BALL_R - 1e-6) / CELL);
	if (vy > 0) {
		const gy = Math.floor((y + BALL_R) / CELL);
		for (let gx = left; gx <= right; gx++) {
			if (isWall(level, gx, gy)) {
				return { y: gy * CELL - BALL_R - 1e-4, vy: 0 };
			}
		}
	} else if (vy < 0) {
		const gy = Math.floor((y - BALL_R) / CELL);
		for (let gx = left; gx <= right; gx++) {
			if (isWall(level, gx, gy)) {
				return { y: (gy + 1) * CELL + BALL_R + 1e-4, vy: 0 };
			}
		}
	}
	return { y, vy };
}

/**
 * 球を 1 ステップ進める。入力を加速度に、減衰を摩擦に見立てる。
 * 壁とは軸ごとに掃引して衝突解決し、すり抜けを防ぐ。dt は秒。
 */
export function stepBall(
	level: Level,
	ball: Ball,
	input: Input,
	dt: number,
): Ball {
	let vx = ball.vx + input.x * ACCEL * dt;
	let vy = ball.vy + input.y * ACCEL * dt;
	vx -= vx * DAMP * dt;
	vy -= vy * DAMP * dt;
	vx = clampSpeed(vx);
	vy = clampSpeed(vy);

	const movedX = collideX(level, ball.x + vx * dt, ball.y, vx);
	const movedY = collideY(level, movedX.x, ball.y + vy * dt, vy);

	return { x: movedX.x, y: movedY.y, vx: movedX.vx, vy: movedY.vy };
}

/** 球がゴールのマスに入ったか。 */
export function atGoal(level: Level, ball: Ball): boolean {
	return (
		Math.floor(ball.x / CELL) === level.goalCell.gx &&
		Math.floor(ball.y / CELL) === level.goalCell.gy
	);
}
