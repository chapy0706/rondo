/**
 * chess の進行（issue-38）。画面から切り離した純粋な関数。
 *
 * 自分は白番。自分の駒をタップして選び、動かせるマスをタップして指す。指すと CPU（黒番）の
 * 番になり、画面が cpuMove を呼ぶ。お助けは回数の制限なしで、CPU と同じ選び方の手を示す。
 */

import type { MoveChooser } from "./cpu";
import {
	type Color,
	type Move,
	type Position,
	type Square,
	applyMove,
	initialPosition,
	legalMoves,
	pieceAt,
	status,
} from "./rules";

export const PLAYER: Color = "w";

export interface GameState {
	readonly position: Position;
	/** 選んでいる自分の駒。 */
	readonly selected: Square | null;
	/** お助けで示している手。 */
	readonly hint: Move | null;
	readonly hintsUsed: number;
	/** 直前に指された手（どちらの手でも）。 */
	readonly lastMove: Move | null;
}

export type Outcome =
	| { readonly kind: "playing"; readonly check: boolean }
	| { readonly kind: "win" }
	| { readonly kind: "lose" }
	| { readonly kind: "draw"; readonly reason: "stalemate" | "fifty-move" };

export function startGame(): GameState {
	return {
		position: initialPosition(),
		selected: null,
		hint: null,
		hintsUsed: 0,
		lastMove: null,
	};
}

/** 自分から見た勝敗。 */
export function outcome(state: GameState): Outcome {
	const s = status(state.position);
	switch (s.kind) {
		case "playing":
			return { kind: "playing", check: s.check };
		case "checkmate":
			return { kind: s.winner === PLAYER ? "win" : "lose" };
		case "stalemate":
		case "fifty-move":
			return { kind: "draw", reason: s.kind };
	}
}

function playersTurn(state: GameState): boolean {
	return state.position.turn === PLAYER && outcome(state).kind === "playing";
}

function sameSquare(a: Square, b: Square): boolean {
	return a.file === b.file && a.rank === b.rank;
}

/** 選んでいる駒の合法手。 */
export function movesFrom(state: GameState): Move[] {
	const selected = state.selected;
	if (selected === null) return [];
	return legalMoves(state.position).filter((m) => sameSquare(m.from, selected));
}

function play(state: GameState, move: Move): GameState {
	return {
		...state,
		position: applyMove(state.position, move),
		selected: null,
		hint: null,
		lastMove: move,
	};
}

/** マスをタップした。自分の番で、対局中のときだけ受け付ける。 */
export function tapSquare(state: GameState, sq: Square): GameState {
	if (!playersTurn(state)) return state;
	const move = movesFrom(state).find((m) => sameSquare(m.to, sq));
	if (move !== undefined) return play(state, move);
	const piece = pieceAt(state.position.board, sq);
	if (
		piece?.color === PLAYER &&
		!(state.selected !== null && sameSquare(state.selected, sq))
	) {
		return { ...state, selected: sq };
	}
	return { ...state, selected: null };
}

/** お助け。chooser（CPU と同じ選び方）の手を示す。回数の制限は無い。 */
export function askHint(state: GameState, chooser: MoveChooser): GameState {
	if (!playersTurn(state)) return state;
	return {
		...state,
		hint: chooser.choose(state.position),
		hintsUsed: state.hintsUsed + 1,
	};
}

/** CPU の手番。CPU の番で、対局中のときだけ指す。 */
export function cpuMove(state: GameState, chooser: MoveChooser): GameState {
	if (state.position.turn === PLAYER || outcome(state).kind !== "playing") {
		return state;
	}
	const move = chooser.choose(state.position);
	return move === null ? state : play(state, move);
}
