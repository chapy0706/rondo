/**
 * chess の CPU（issue-38）。「局面を受け取り、手を返す」差し替え可能な形にする。
 *
 * 初期実装の simpleCpu は、合法手を全て並べて次の順に選ぶ。
 *   1. 1手で詰ませられる手があれば、それを指す
 *   2. 駒を取れる手があれば、価値の高い駒を取る手を指す（同じ価値なら乱数で選ぶ）
 *   3. それ以外は、合法手からランダムに選ぶ
 * 将来、棋譜から学習する CPU は、同じ MoveChooser を実装して入れ替える。
 */

import {
	type Move,
	type PieceType,
	type Position,
	applyMove,
	legalMoves,
	status,
} from "./rules";

/** 局面から、手番の側が指す手を選ぶ。指せる手が無ければ null。 */
export interface MoveChooser {
	choose(position: Position): Move | null;
}

/** 乱数。0 以上 1 未満を返す。 */
export type Random = () => number;

/** 駒の価値（取る駒を選ぶときの目安）。キングは取られないので 0。 */
export const PIECE_VALUES: Readonly<Record<PieceType, number>> = {
	Q: 9,
	R: 5,
	B: 3,
	N: 3,
	P: 1,
	K: 0,
};

function pick<T>(items: readonly T[], random: Random): T | null {
	return items[Math.floor(random() * items.length)] ?? null;
}

export function simpleCpu(random: Random): MoveChooser {
	return {
		choose(position) {
			const moves = legalMoves(position);
			if (moves.length === 0) return null;

			const mates = moves.filter(
				(move) => status(applyMove(position, move)).kind === "checkmate",
			);
			if (mates.length > 0) return pick(mates, random);

			const captures = moves.filter((move) => move.captured !== null);
			if (captures.length > 0) {
				const value = (move: Move) =>
					move.captured === null ? 0 : PIECE_VALUES[move.captured.type];
				const best = Math.max(...captures.map(value));
				return pick(
					captures.filter((move) => value(move) === best),
					random,
				);
			}

			return pick(moves, random);
		},
	};
}
