/**
 * Tilt Maze の純粋なクライアントロジック（ADR 0004 のリアルタイムゲーム本体）。
 *
 * 迷路の生成と球の物理をここに閉じ込め、描画・入力・通信からは切り離す。物理は
 * クライアントで回すが、順位はサーバー受信順で確定するため（ADR 0014）、この
 * モジュールは到達判定までを担い、勝敗の決定権は持たない。乱数は seed で決まり、
 * 面番号を seed にするため 10 面は毎回同じ形になる。
 */

/** 迷路セル 1 マスの描画・当たり判定サイズ（px）。 */
export const CELL = 24;
/** 球の半径（px）。通路幅（CELL）より十分小さくして詰まらないようにする。 */
export const BALL_R = 8;
/** 面数。 */
export const TOTAL_LEVELS = 10;

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

/** 1 面分の迷路。grid[gy][gx] が true なら壁。 */
export interface Level {
	readonly index: number;
	readonly grid: readonly (readonly boolean[])[];
	readonly gridCols: number;
	readonly gridRows: number;
	readonly widthPx: number;
	readonly heightPx: number;
	readonly start: Vec;
	readonly goal: Vec;
	readonly goalCell: { readonly gx: number; readonly gy: number };
}

/** プレイ全体の進行。 */
export interface RunState {
	readonly levelIndex: number;
	readonly ball: Ball;
	readonly cleared: boolean;
}

function nextRandom(seed: number): { value: number; seed: number } {
	let s = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(s ^ (s >>> 15), 1 | s);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	s = t | 0;
	return { value, seed: s };
}

/** 面番号に応じた迷路のマス数（縦横同数）。面が進むほど広く難しくする。 */
function cellsForLevel(index: number): number {
	return Math.min(4 + Math.floor(index / 2), 7);
}

/**
 * 再帰的バックトラッカーで完全迷路（全マスが連結）を作る。
 * grid は (2*cols+1) x (2*rows+1)。true=壁。start と goal の間には必ず道がある。
 */
function generateMaze(cols: number, rows: number, seed: number): boolean[][] {
	const gridCols = 2 * cols + 1;
	const gridRows = 2 * rows + 1;
	const grid: boolean[][] = Array.from({ length: gridRows }, () =>
		Array.from({ length: gridCols }, () => true),
	);
	const visited: boolean[][] = Array.from({ length: rows }, () =>
		Array.from({ length: cols }, () => false),
	);

	const open = (gx: number, gy: number) => {
		const row = grid[gy];
		if (row) row[gx] = false;
	};
	const markVisited = (cx: number, cy: number) => {
		const row = visited[cy];
		if (row) row[cx] = true;
	};
	const isVisited = (cx: number, cy: number): boolean =>
		visited[cy]?.[cx] ?? true;

	let s = seed === 0 ? 1 : seed;
	const random = () => {
		const r = nextRandom(s);
		s = r.seed;
		return r.value;
	};

	const directions: readonly (readonly [number, number])[] = [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
	];

	const stack: [number, number][] = [[0, 0]];
	markVisited(0, 0);
	open(1, 1);

	while (stack.length > 0) {
		const top = stack[stack.length - 1];
		if (top === undefined) break;
		const [cx, cy] = top;

		const candidates: [number, number, number, number][] = [];
		for (const [dx, dy] of directions) {
			const nx = cx + dx;
			const ny = cy + dy;
			if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !isVisited(nx, ny)) {
				candidates.push([nx, ny, dx, dy]);
			}
		}

		if (candidates.length === 0) {
			stack.pop();
			continue;
		}

		const pick = candidates[Math.floor(random() * candidates.length)];
		if (pick === undefined) continue;
		const [nx, ny, dx, dy] = pick;
		markVisited(nx, ny);
		open(2 * cx + 1 + dx, 2 * cy + 1 + dy);
		open(2 * nx + 1, 2 * ny + 1);
		stack.push([nx, ny]);
	}

	return grid;
}

function centerPx(gx: number, gy: number): Vec {
	return { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
}

function buildLevel(index: number): Level {
	const cells = cellsForLevel(index);
	const grid = generateMaze(cells, cells, index + 1);
	const gridCols = 2 * cells + 1;
	const gridRows = 2 * cells + 1;
	const goalGx = 2 * (cells - 1) + 1;
	const goalGy = 2 * (cells - 1) + 1;
	return {
		index,
		grid,
		gridCols,
		gridRows,
		widthPx: gridCols * CELL,
		heightPx: gridRows * CELL,
		start: centerPx(1, 1),
		goal: centerPx(goalGx, goalGy),
		goalCell: { gx: goalGx, gy: goalGy },
	};
}

/** 10 面。面番号 seed で決まるため毎回同じ形になる。 */
export const LEVELS: readonly Level[] = Array.from(
	{ length: TOTAL_LEVELS },
	(_, index) => buildLevel(index),
);

/** 面を取り出す。範囲外は最後の面に丸める。 */
export function levelAt(index: number): Level {
	return (
		LEVELS[Math.min(Math.max(index, 0), TOTAL_LEVELS - 1)] ?? buildLevel(0)
	);
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

/** 新しいプレイを始める。 */
export function createRun(): RunState {
	const first = levelAt(0);
	return { levelIndex: 0, ball: startBall(first), cleared: false };
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
