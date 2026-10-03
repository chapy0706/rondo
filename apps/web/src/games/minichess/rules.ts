/**
 * chess（内部名 minichess）の規則（issue-38）。画面から切り離した純粋な関数。
 *
 * 5×5 のガードナー配置。駒の動きは通常のチェスに従うが、ポーンの二歩前進・アンパッサン・
 * キャスリングは無い。ポーンは最奥段でクイーンに昇格する（選択なし）。合法手は、指した後に
 * 自分のキングが取られる手を除いたもの。詰み・ステイルメイト・50手引き分けを判定する。
 */

export const SIZE = 5;
/** 50手引き分けの手数（双方50手ずつ = 100 手）。 */
export const FIFTY_MOVE_PLIES = 100;

export type Color = "w" | "b";
export type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";

export interface Piece {
	readonly color: Color;
	readonly type: PieceType;
}

/** file は a〜e（0〜4）、rank は 1〜5 段目（0〜4）。 */
export interface Square {
	readonly file: number;
	readonly rank: number;
}

/** board[rank][file]。 */
export type Board = readonly (readonly (Piece | null)[])[];

export interface Position {
	readonly board: Board;
	readonly turn: Color;
	/** ポーンの動きも駒の取りも無い手が続いた数。 */
	readonly halfmoveClock: number;
}

export interface Move {
	readonly from: Square;
	readonly to: Square;
	/** 取る駒（無ければ null）。 */
	readonly captured: Piece | null;
	/** 昇格するか（常にクイーン）。 */
	readonly promotion: boolean;
}

export type Status =
	| { readonly kind: "playing"; readonly check: boolean }
	| { readonly kind: "checkmate"; readonly winner: Color }
	| { readonly kind: "stalemate" }
	| { readonly kind: "fifty-move" };

export function opponent(color: Color): Color {
	return color === "w" ? "b" : "w";
}

/** "a1" 〜 "e5" をマスにする。 */
export function square(name: string): Square {
	return {
		file: "abcde".indexOf(name.charAt(0)),
		rank: Number(name.charAt(1)) - 1,
	};
}

export function pieceAt(board: Board, sq: Square): Piece | null {
	return board[sq.rank]?.[sq.file] ?? null;
}

function inside(sq: Square): boolean {
	return sq.file >= 0 && sq.file < SIZE && sq.rank >= 0 && sq.rank < SIZE;
}

const TYPES: Readonly<Record<string, PieceType>> = {
	k: "K",
	q: "Q",
	r: "R",
	b: "B",
	n: "N",
	p: "P",
};

/**
 * 図から盤面を作る。rows[0] が 5 段目。大文字が白、小文字が黒、"." が空き。
 */
export function parseBoard(rows: readonly string[]): Board {
	return [...rows].reverse().map((row) =>
		Array.from(row).map((ch): Piece | null => {
			const type = TYPES[ch.toLowerCase()];
			if (type === undefined) return null;
			return { color: ch === ch.toUpperCase() ? "w" : "b", type };
		}),
	);
}

export function initialPosition(): Position {
	return {
		board: parseBoard(["rnbqk", "ppppp", ".....", "PPPPP", "RNBQK"]),
		turn: "w",
		halfmoveClock: 0,
	};
}

const ROOK_DIRS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
] as const;
const BISHOP_DIRS = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
] as const;
const KING_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];
const KNIGHT_JUMPS = [
	[1, 2],
	[2, 1],
	[2, -1],
	[1, -2],
	[-1, -2],
	[-2, -1],
	[-2, 1],
	[-1, 2],
] as const;

function forward(color: Color): number {
	return color === "w" ? 1 : -1;
}

function lastRank(color: Color): number {
	return color === "w" ? SIZE - 1 : 0;
}

/** 王手の確認を除いた、駒の動きとしての手。 */
function pseudoMoves(board: Board, color: Color): Move[] {
	const moves: Move[] = [];
	const add = (from: Square, to: Square, piece: Piece) => {
		moves.push({
			from,
			to,
			captured: pieceAt(board, to),
			promotion: piece.type === "P" && to.rank === lastRank(color),
		});
	};
	/** 空きか相手の駒なら行ける。 */
	const canLand = (to: Square) =>
		inside(to) && pieceAt(board, to)?.color !== color;

	for (let rank = 0; rank < SIZE; rank++) {
		for (let file = 0; file < SIZE; file++) {
			const from = { file, rank };
			const piece = pieceAt(board, from);
			if (piece === null || piece.color !== color) continue;

			const slide = (dirs: readonly (readonly [number, number])[]) => {
				for (const [df, dr] of dirs) {
					let to = { file: file + df, rank: rank + dr };
					while (canLand(to)) {
						add(from, to, piece);
						if (pieceAt(board, to) !== null) break;
						to = { file: to.file + df, rank: to.rank + dr };
					}
				}
			};
			const step = (dirs: readonly (readonly [number, number])[]) => {
				for (const [df, dr] of dirs) {
					const to = { file: file + df, rank: rank + dr };
					if (canLand(to)) add(from, to, piece);
				}
			};

			switch (piece.type) {
				case "R":
					slide(ROOK_DIRS);
					break;
				case "B":
					slide(BISHOP_DIRS);
					break;
				case "Q":
					slide(KING_DIRS);
					break;
				case "K":
					step(KING_DIRS);
					break;
				case "N":
					step(KNIGHT_JUMPS);
					break;
				case "P": {
					const dir = forward(color);
					const ahead = { file, rank: rank + dir };
					if (inside(ahead) && pieceAt(board, ahead) === null) {
						add(from, ahead, piece);
					}
					for (const df of [-1, 1]) {
						const to = { file: file + df, rank: rank + dir };
						const target = inside(to) ? pieceAt(board, to) : null;
						if (target !== null && target.color !== color) {
							add(from, to, piece);
						}
					}
					break;
				}
			}
		}
	}
	return moves;
}

function moveOnBoard(board: Board, move: Move): Board {
	const piece = pieceAt(board, move.from);
	const placed: Piece | null =
		piece !== null && move.promotion
			? { color: piece.color, type: "Q" }
			: piece;
	return board.map((row, rank) =>
		row.map((cell, file) => {
			if (rank === move.to.rank && file === move.to.file) return placed;
			if (rank === move.from.rank && file === move.from.file) return null;
			return cell;
		}),
	);
}

function kingSquare(board: Board, color: Color): Square | null {
	for (let rank = 0; rank < SIZE; rank++) {
		for (let file = 0; file < SIZE; file++) {
			const piece = pieceAt(board, { file, rank });
			if (piece?.color === color && piece.type === "K") return { file, rank };
		}
	}
	return null;
}

function attacked(board: Board, sq: Square, by: Color): boolean {
	return pseudoMoves(board, by).some(
		(m) => m.to.file === sq.file && m.to.rank === sq.rank,
	);
}

/** color のキングが王手されているか。 */
export function inCheck(position: Position, color: Color): boolean {
	const king = kingSquare(position.board, color);
	return king !== null && attacked(position.board, king, opponent(color));
}

/** 手番の側の合法手（指した後に自分のキングが取られる手を除く）。 */
export function legalMoves(position: Position): Move[] {
	const color = position.turn;
	return pseudoMoves(position.board, color).filter((move) => {
		const board = moveOnBoard(position.board, move);
		const king = kingSquare(board, color);
		return king !== null && !attacked(board, king, opponent(color));
	});
}

/** 手を指した後の局面。ポーンの動きか取りで、50手の数を0に戻す。 */
export function applyMove(position: Position, move: Move): Position {
	const moved = pieceAt(position.board, move.from);
	const resets = moved?.type === "P" || move.captured !== null;
	return {
		board: moveOnBoard(position.board, move),
		turn: opponent(position.turn),
		halfmoveClock: resets ? 0 : position.halfmoveClock + 1,
	};
}

/** 手番の側から見た、局面の状態。 */
export function status(position: Position): Status {
	const check = inCheck(position, position.turn);
	if (legalMoves(position).length === 0) {
		return check
			? { kind: "checkmate", winner: opponent(position.turn) }
			: { kind: "stalemate" };
	}
	if (position.halfmoveClock >= FIFTY_MOVE_PLIES) return { kind: "fifty-move" };
	return { kind: "playing", check };
}
