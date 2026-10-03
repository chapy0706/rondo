import { describe, expect, it } from "vitest";
import { type MoveChooser, PIECE_VALUES, simpleCpu } from "./cpu";
import {
	type Move,
	type Position,
	applyMove,
	initialPosition,
	legalMoves,
	parseBoard,
	pieceAt,
	square,
	status,
} from "./rules";

function position(turn: "w" | "b", ...rows: string[]): Position {
	return { board: parseBoard(rows), turn, halfmoveClock: 0 };
}

function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

const same = (a: Move, b: Move) =>
	a.from.file === b.from.file &&
	a.from.rank === b.from.rank &&
	a.to.file === b.to.file &&
	a.to.rank === b.to.rank;

const isLegal = (p: Position, m: Move) =>
	legalMoves(p).some((legal) => same(legal, m));

describe("simpleCpu - 手の選び方", () => {
	it("1手で詰ませられるなら、駒を取れる手より詰ませる手を指す", () => {
		// Re5 で詰み。キングかルークで黒のナイト d1 も取れるが、詰みを優先する。
		const p = position("w", "k....", "pp...", ".....", "..K..", "...nR");
		const move = simpleCpu(seeded(1)).choose(p);
		expect(move).not.toBeNull();
		if (move === null) return;
		expect(status(applyMove(p, move))).toEqual({
			kind: "checkmate",
			winner: "w",
		});
	});

	it("詰ませる手が無ければ、価値の高い駒を取る手を指す", () => {
		// ルーク c1 は、黒のナイト a1 とクイーン c4 のどちらも取れる。クイーンを取る。
		const p = position("w", "....k", "..q..", ".....", ".....", "n.R.K");
		for (let seed = 1; seed <= 20; seed++) {
			const move = simpleCpu(seeded(seed)).choose(p);
			expect(move?.to).toEqual(square("c4"));
		}
	});

	it("駒の価値は クイーン > ルーク > ビショップ・ナイト > ポーン", () => {
		expect(PIECE_VALUES.Q).toBeGreaterThan(PIECE_VALUES.R);
		expect(PIECE_VALUES.R).toBeGreaterThan(PIECE_VALUES.B);
		expect(PIECE_VALUES.B).toBe(PIECE_VALUES.N);
		expect(PIECE_VALUES.N).toBeGreaterThan(PIECE_VALUES.P);
	});

	it("取る手も詰みも無ければ、合法手からランダムに選ぶ（同じ乱数なら同じ手）", () => {
		const p = initialPosition();
		const a = simpleCpu(seeded(5)).choose(p);
		expect(a).not.toBeNull();
		if (a === null) return;
		expect(isLegal(p, a)).toBe(true);
		const b = simpleCpu(seeded(5)).choose(p);
		expect(b !== null && same(a, b)).toBe(true);
		// 乱数を変えれば、いろいろな手が選ばれる。
		const picked = new Set<string>();
		for (let seed = 1; seed <= 30; seed++) {
			const m = simpleCpu(seeded(seed)).choose(p);
			if (m !== null)
				picked.add(`${m.from.file}${m.from.rank}${m.to.file}${m.to.rank}`);
		}
		expect(picked.size).toBeGreaterThan(1);
	});

	it("指せる手が無ければ null", () => {
		const stalemate = position(
			"b",
			"k....",
			".....",
			".Q...",
			"..K..",
			".....",
		);
		expect(simpleCpu(seeded(1)).choose(stalemate)).toBeNull();
	});

	it("CPU どうしで最後まで指させても、常に合法手を指す", () => {
		for (let seed = 1; seed <= 10; seed++) {
			const cpu: MoveChooser = simpleCpu(seeded(seed));
			let p = initialPosition();
			for (let ply = 0; ply < 300 && status(p).kind === "playing"; ply++) {
				const move = cpu.choose(p);
				expect(move).not.toBeNull();
				if (move === null) break;
				expect(isLegal(p, move)).toBe(true);
				// 自分の駒を動かしている。
				expect(pieceAt(p.board, move.from)?.color).toBe(p.turn);
				p = applyMove(p, move);
			}
		}
	});
});
