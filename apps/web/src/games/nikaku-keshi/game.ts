/**
 * link（二角消去）の進行（issue-37）。画面から切り離した純粋な関数。
 *
 * - 1枚目をタップで選び、2枚目で結べれば2枚とも消す。結べなければ選択を解除する
 * - お助けは HINT_LIMIT 回目まで、今消せるペアを1組示す。それを超えると「答えを見る」に
 *   なり、押すと自動で消す状態（auto）に入る。画面が 0.5 秒ごとに autoStep を呼ぶ
 * - 自動で消すとき、詰んだら自動でシャッフルする。自動のシャッフルが上限に達したら止まる
 * - 手で遊ぶとき、詰んだらシャッフルボタンを出す（canShuffle）
 */

import {
	type Board,
	type Cell,
	type Pair,
	type Random,
	canConnect,
	findPair,
	isCleared,
	isStuck,
	remove,
	shuffle,
} from "./board";

/** お助けでペアを示す回数。これを超えると「答えを見る」になる。 */
export const HINT_LIMIT = 3;
/** 「答えを見る」の間に、自動でシャッフルしてよい回数の上限。 */
export const AUTO_SHUFFLE_LIMIT = 10;

export type Mode = "playing" | "auto" | "cleared" | "halted";

export interface GameState {
	readonly board: Board;
	readonly selected: Cell | null;
	/** お助けで示しているペア。 */
	readonly highlight: Pair | null;
	readonly hintsUsed: number;
	/** シャッフルした回数（手でも自動でも数える）。 */
	readonly shuffles: number;
	/** 「答えを見る」の間に自動でシャッフルした回数。 */
	readonly autoShuffles: number;
	readonly mode: Mode;
	/** 自動で消すのを止めた理由。 */
	readonly haltReason: string | null;
}

export function startGame(board: Board): GameState {
	return {
		board,
		selected: null,
		highlight: null,
		hintsUsed: 0,
		shuffles: 0,
		autoShuffles: 0,
		mode: "playing",
		haltReason: null,
	};
}

function same(a: Cell, b: Cell): boolean {
	return a.x === b.x && a.y === b.y;
}

function afterRemove(state: GameState, pair: Pair): GameState {
	const board = remove(state.board, pair);
	return {
		...state,
		board,
		selected: null,
		highlight: null,
		mode: isCleared(board) ? "cleared" : state.mode,
	};
}

/** 牌をタップした。遊んでいる間だけ受け付ける。 */
export function tap(state: GameState, cell: Cell): GameState {
	if (state.mode !== "playing") return state;
	if (state.board[cell.y]?.[cell.x] == null) return state;
	const selected = state.selected;
	if (selected === null) return { ...state, selected: cell };
	if (same(selected, cell)) return { ...state, selected: null };
	if (canConnect(state.board, selected, cell)) {
		return afterRemove(state, [selected, cell]);
	}
	// 結べないときは選択を解除する。
	return { ...state, selected: null };
}

/** お助けボタンの文言。 */
export function hintLabel(state: GameState): string {
	const left = HINT_LIMIT - state.hintsUsed;
	return left > 0 ? `お助け（あと ${left} 回）` : "答えを見る";
}

/**
 * お助けを使った。HINT_LIMIT 回目までは消せるペアを示し、それを超えると自動で消し始める。
 * 詰んでいてペアを示せないときは、回数を使わない（シャッフルを促す）。
 */
export function askHint(state: GameState): GameState {
	if (state.mode !== "playing") return state;
	if (state.hintsUsed >= HINT_LIMIT) {
		return {
			...state,
			hintsUsed: state.hintsUsed + 1,
			selected: null,
			highlight: null,
			mode: "auto",
		};
	}
	const pair = findPair(state.board);
	if (pair === null) return state;
	return { ...state, hintsUsed: state.hintsUsed + 1, highlight: pair };
}

/** 手で遊んでいて、詰んでいるときだけシャッフルできる。 */
export function canShuffle(state: GameState): boolean {
	return state.mode === "playing" && isStuck(state.board);
}

/** シャッフルボタン。詰んでいないときは何もしない。 */
export function manualShuffle(state: GameState, random: Random): GameState {
	if (!canShuffle(state)) return state;
	return reshuffle(state, random);
}

function reshuffle(state: GameState, random: Random): GameState {
	const result = shuffle(state.board, random);
	if (!result.ok) {
		return {
			...state,
			mode: "halted",
			haltReason: "並べ替えても、消せるペアを作れませんでした。",
		};
	}
	return {
		...state,
		board: result.board,
		selected: null,
		highlight: null,
		shuffles: state.shuffles + 1,
	};
}

/**
 * 「答えを見る」の1歩。消せるペアを1組消す。詰んでいたら自動でシャッフルし、
 * 自動のシャッフルが上限に達していたら理由を出して止まる。
 */
export function autoStep(state: GameState, random: Random): GameState {
	if (state.mode !== "auto") return state;
	const pair = findPair(state.board);
	if (pair !== null) return afterRemove(state, pair);
	if (state.autoShuffles >= AUTO_SHUFFLE_LIMIT) {
		return {
			...state,
			mode: "halted",
			haltReason: `自動のシャッフルが上限（${AUTO_SHUFFLE_LIMIT}回）に達したため止めました。`,
		};
	}
	const shuffled = reshuffle(state, random);
	return shuffled.mode === "halted"
		? shuffled
		: { ...shuffled, autoShuffles: state.autoShuffles + 1 };
}
