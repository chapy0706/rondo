import { describe, expect, it } from "vitest";
import {
	type Cell,
	type GameState,
	HEIGHT,
	WIDTH,
	createGame,
	hardDrop,
	moveLeft,
	moveRight,
	renderBoard,
	rotate,
	step,
} from "./engine";

function emptyBoard(): Cell[][] {
	return Array.from({ length: HEIGHT }, () =>
		Array.from({ length: WIDTH }, () => null as Cell),
	);
}

/** 現在ピースを重ねた盤面から、埋まっている列の一覧を得る。 */
function occupiedColumns(game: GameState): number[] {
	const columns: number[] = [];
	for (const row of renderBoard(game)) {
		row.forEach((cell, x) => {
			if (cell !== null) columns.push(x);
		});
	}
	return columns;
}

describe("createGame", () => {
	it("同じ seed からは同じ初期状態になる", () => {
		expect(createGame(1234)).toEqual(createGame(1234));
	});

	it("開始時は空盤面・スコア0・レベル1", () => {
		const game = createGame(1);
		expect(game.score).toBe(0);
		expect(game.level).toBe(1);
		expect(game.gameOver).toBe(false);
		expect(game.board.every((row) => row.every((cell) => cell === null))).toBe(
			true,
		);
	});
});

describe("移動", () => {
	it("左の壁を越えない", () => {
		let game = createGame(1);
		for (let i = 0; i < WIDTH; i++) game = moveLeft(game);
		expect(Math.min(...occupiedColumns(game))).toBeGreaterThanOrEqual(0);
	});

	it("右の壁を越えない", () => {
		let game = createGame(1);
		for (let i = 0; i < WIDTH; i++) game = moveRight(game);
		expect(Math.max(...occupiedColumns(game))).toBeLessThan(WIDTH);
	});
});

describe("回転", () => {
	it("回転で rotation が進む（衝突しない盤面で）", () => {
		const game = createGame(1);
		expect(rotate(game).current.rotation).toBe((game.current.rotation + 1) % 4);
	});
});

describe("ライン消去", () => {
	it("行が揃うと消えて加点される", () => {
		const board = emptyBoard();
		// 最下行を列4,5だけ空けて埋めておく。
		const bottom = board[HEIGHT - 1];
		if (bottom) {
			for (let x = 0; x < WIDTH; x++) {
				bottom[x] = x === 4 || x === 5 ? null : "I";
			}
		}
		const state: GameState = {
			...createGame(1),
			board,
			current: { type: "O", rotation: 0, x: 4, y: 0 },
		};

		const after = hardDrop(state);
		expect(after.lines).toBe(1);
		expect(after.score).toBeGreaterThanOrEqual(100);
	});
});

describe("ゲームオーバー", () => {
	it("出現位置が塞がっていると gameOver になる", () => {
		const board = emptyBoard();
		// 次のピース O の出現セル(4,0)(5,0) を塞ぐ。
		const top = board[0];
		if (top) {
			top[4] = "I";
			top[5] = "I";
		}
		const state: GameState = {
			...createGame(1),
			board,
			current: { type: "O", rotation: 0, x: 0, y: HEIGHT - 2 },
			next: "O",
		};

		// 現在ピースを固定 -> 次の O が出現できずゲームオーバー。
		const after = step(step(state));
		expect(after.gameOver).toBe(true);
	});
});
