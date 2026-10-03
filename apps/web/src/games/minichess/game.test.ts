import { describe, expect, it } from "vitest";
import type { MoveChooser } from "./cpu";
import {
	PLAYER,
	askHint,
	cpuMove,
	movesFrom,
	outcome,
	startGame,
	tapSquare,
} from "./game";
import {
	type Move,
	type Position,
	legalMoves,
	parseBoard,
	pieceAt,
	square,
} from "./rules";

function position(turn: "w" | "b", ...rows: string[]): Position {
	return { board: parseBoard(rows), turn, halfmoveClock: 0 };
}

/** 合法手の先頭を選ぶ、決まった CPU。 */
const firstMove: MoveChooser = {
	choose: (p) => legalMoves(p)[0] ?? null,
};

const isLegal = (p: Position, m: Move) =>
	legalMoves(p).some(
		(l) =>
			l.from.file === m.from.file &&
			l.from.rank === m.from.rank &&
			l.to.file === m.to.file &&
			l.to.rank === m.to.rank,
	);

describe("tapSquare - 駒をタップして指す", () => {
	it("自分は白番", () => {
		expect(PLAYER).toBe("w");
		expect(startGame().position.turn).toBe("w");
	});

	it("自分の駒をタップすると選ばれ、動かせるマスが分かる", () => {
		const state = tapSquare(startGame(), square("b1"));
		expect(state.selected).toEqual(square("b1"));
		expect(movesFrom(state).map((m) => m.to)).toEqual(
			expect.arrayContaining([square("a3"), square("c3")]),
		);
	});

	it("動かせるマスをタップすると指し、手番が CPU に替わる", () => {
		let state = tapSquare(startGame(), square("c2"));
		state = tapSquare(state, square("c3"));
		expect(pieceAt(state.position.board, square("c3"))?.type).toBe("P");
		expect(state.position.turn).toBe("b");
		expect(state.selected).toBeNull();
		expect(state.lastMove?.to).toEqual(square("c3"));
	});

	it("別の自分の駒をタップすると選び直し、行けないマスなら選択を解除する", () => {
		let state = tapSquare(startGame(), square("c2"));
		state = tapSquare(state, square("b1"));
		expect(state.selected).toEqual(square("b1"));
		state = tapSquare(state, square("e4"));
		expect(state.selected).toBeNull();
	});

	it("相手の駒や空きマスは選べない。CPU の番には指せない", () => {
		expect(tapSquare(startGame(), square("c4")).selected).toBeNull();
		expect(tapSquare(startGame(), square("c3")).selected).toBeNull();
		const cpuTurn = tapSquare(
			tapSquare(startGame(), square("c2")),
			square("c3"),
		);
		expect(tapSquare(cpuTurn, square("b1"))).toBe(cpuTurn);
	});
});

describe("askHint - お助け（回数の制限なし）", () => {
	it("何度でも使え、示す手は毎回合法手で、使った回数が数えられる", () => {
		let state = startGame();
		for (let i = 1; i <= 10; i++) {
			state = askHint(state, firstMove);
			expect(state.hintsUsed).toBe(i);
			expect(state.hint).not.toBeNull();
			if (state.hint !== null) {
				expect(isLegal(state.position, state.hint)).toBe(true);
			}
		}
	});

	it("指すと、示していた手は消える（回数は残る）", () => {
		let state = askHint(startGame(), firstMove);
		state = tapSquare(state, square("c2"));
		state = tapSquare(state, square("c3"));
		expect(state.hint).toBeNull();
		expect(state.hintsUsed).toBe(1);
	});

	it("CPU の番や対局が終わった後は使えない", () => {
		const cpuTurn = tapSquare(
			tapSquare(startGame(), square("c2")),
			square("c3"),
		);
		expect(askHint(cpuTurn, firstMove)).toBe(cpuTurn);
	});
});

describe("cpuMove / outcome - CPU の手番と勝敗", () => {
	it("CPU は黒番で合法手を指し、手番が自分に戻る", () => {
		const cpuTurn = tapSquare(
			tapSquare(startGame(), square("c2")),
			square("c3"),
		);
		const state = cpuMove(cpuTurn, firstMove);
		expect(state.position.turn).toBe("w");
		expect(state.lastMove).not.toBeNull();
		if (state.lastMove !== null) {
			expect(isLegal(cpuTurn.position, state.lastMove)).toBe(true);
		}
	});

	it("自分の番には CPU は指さない", () => {
		const state = startGame();
		expect(cpuMove(state, firstMove)).toBe(state);
	});

	it("勝敗を自分から見て返す", () => {
		const win = {
			...startGame(),
			position: position("b", "k....", ".Q...", "..K..", ".....", "....."),
		};
		expect(outcome(win)).toEqual({ kind: "win" });
		const lose = {
			...startGame(),
			position: position("w", "K....", ".q...", "..k..", ".....", "....."),
		};
		expect(outcome(lose)).toEqual({ kind: "lose" });
		const draw = {
			...startGame(),
			position: position("b", "k....", ".....", ".Q...", "..K..", "....."),
		};
		expect(outcome(draw)).toEqual({ kind: "draw", reason: "stalemate" });
		expect(outcome(startGame())).toEqual({ kind: "playing", check: false });
	});

	it("対局が終わったら、タップも CPU も受け付けない", () => {
		const over = {
			...startGame(),
			position: position("w", "K....", ".q...", "..k..", ".....", "....."),
		};
		expect(tapSquare(over, square("a5"))).toBe(over);
		expect(askHint(over, firstMove)).toBe(over);
	});
});
