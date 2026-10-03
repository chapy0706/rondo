import { describe, expect, it } from "vitest";
import {
	FIFTY_MOVE_PLIES,
	type Move,
	type Position,
	type Square,
	applyMove,
	inCheck,
	initialPosition,
	legalMoves,
	parseBoard,
	pieceAt,
	square,
	status,
} from "./rules";

/** 図から局面を作る。上が5段目、大文字が白、小文字が黒、"." が空き。 */
function position(turn: "w" | "b", ...rows: string[]): Position {
	return { board: parseBoard(rows), turn, halfmoveClock: 0 };
}

/** その駒の行き先（"a3" の形、並びは辞書順）。 */
function targets(p: Position, from: string): string[] {
	return legalMoves(p)
		.filter((m) => name(m.from) === from)
		.map((m) => name(m.to))
		.sort();
}

function name(sq: Square): string {
	return `${"abcde"[sq.file]}${sq.rank + 1}`;
}

function move(p: Position, from: string, to: string): Move {
	const found = legalMoves(p).find(
		(m) => name(m.from) === from && name(m.to) === to,
	);
	if (found === undefined) throw new Error(`illegal: ${from}-${to}`);
	return found;
}

describe("初期配置（ガードナーの 5×5）", () => {
	it("白は 1 段目に R N B Q K、2 段目にポーン。黒は向かい合わせ", () => {
		const p = initialPosition();
		expect(p.turn).toBe("w");
		expect(pieceAt(p.board, square("a1"))).toEqual({ color: "w", type: "R" });
		expect(pieceAt(p.board, square("e1"))).toEqual({ color: "w", type: "K" });
		expect(pieceAt(p.board, square("d5"))).toEqual({ color: "b", type: "Q" });
		expect(pieceAt(p.board, square("c4"))).toEqual({ color: "b", type: "P" });
	});

	it("最初の合法手は、ポーンの1歩前進5つと、ナイトの2つ", () => {
		const moves = legalMoves(initialPosition());
		expect(moves).toHaveLength(7);
		expect(targets(initialPosition(), "b1")).toEqual(["a3", "c3"]);
		// ポーンの二歩前進は無い。
		expect(targets(initialPosition(), "c2")).toEqual(["c3"]);
	});
});

describe("駒の動き（通常のチェスどおり）", () => {
	it("ルークは縦横にまっすぐ、駒の手前（取りを含む）まで", () => {
		const p = position("w", "..p..", ".....", "..R..", ".....", "K...k");
		expect(targets(p, "c3")).toEqual([
			"a3",
			"b3",
			"c1",
			"c2",
			"c4",
			"c5",
			"d3",
			"e3",
		]);
	});

	it("ビショップは斜めにまっすぐ", () => {
		const p = position("w", "...k.", ".....", "..B..", ".....", "K....");
		expect(targets(p, "c3")).toEqual([
			"a5",
			"b2",
			"b4",
			"d2",
			"d4",
			"e1",
			"e5",
		]);
	});

	it("クイーンは縦横斜め", () => {
		const p = position("w", ".K.k.", ".....", "..Q..", ".....", ".....");
		expect(targets(p, "c3")).toHaveLength(16);
	});

	it("ナイトはL字に跳び、間の駒を越える", () => {
		const p = position("w", ".....", ".PPP.", ".PNP.", ".PPP.", "K...k");
		expect(targets(p, "c3")).toEqual([
			"a2",
			"a4",
			"b1",
			"b5",
			"d1",
			"d5",
			"e2",
			"e4",
		]);
	});

	it("キングは周り1マス。相手のキングの隣には行けない", () => {
		const p = position("w", "....k", ".....", "..K..", ".....", ".....");
		expect(targets(p, "c3")).toEqual([
			"b2",
			"b3",
			"b4",
			"c2",
			"c4",
			"d2",
			"d3",
		]);
	});

	it("ポーンは前に1マス、取りは斜め前。前が塞がっていれば進めない", () => {
		const p = position("w", "....k", ".....", ".p.p.", "..P..", "K....");
		expect(targets(p, "c2")).toEqual(["b3", "c3", "d3"]);
		const blocked = position("w", "....k", ".....", "..p..", "..P..", "K....");
		expect(targets(blocked, "c2")).toEqual([]);
	});

	it("黒のポーンは下に進む", () => {
		const p = position("b", "....k", "..p..", ".....", ".....", "K....");
		expect(targets(p, "c4")).toEqual(["c3"]);
	});
});

describe("自分の王に王手がかかる手は指せない", () => {
	it("ピンされた駒は、ピンを外す方向に動けない", () => {
		// 白のナイト c2 は、黒のルーク c5 と白キング c1 の間にいる。
		const p = position("w", "..r.k", ".....", ".....", "..N..", "..K..");
		expect(targets(p, "c2")).toEqual([]);
	});

	it("キングは相手に利いているマスへ動けない", () => {
		const p = position("w", "....k", ".....", ".r...", ".....", "..K..");
		// b 列は黒ルークが利いている。
		expect(targets(p, "c1")).toEqual(["c2", "d1", "d2"]);
	});

	it("王手のときは、王手を外す手しか指せない", () => {
		const p = position("w", "..r.k", ".....", ".....", "...B.", "..K..");
		expect(inCheck(p, "w")).toBe(true);
		for (const m of legalMoves(p)) {
			expect(inCheck(applyMove(p, m), "w")).toBe(false);
		}
		// ビショップ d2 は c3 に入って合駒できる。
		expect(targets(p, "d2")).toEqual(["c3"]);
	});
});

describe("昇格", () => {
	it("白のポーンが 5 段目に着くとクイーンになる", () => {
		const p = position("w", "....k", "P....", ".....", ".....", "K....");
		const after = applyMove(p, move(p, "a4", "a5"));
		expect(pieceAt(after.board, square("a5"))).toEqual({
			color: "w",
			type: "Q",
		});
	});

	it("黒のポーンが 1 段目に着くとクイーンになる（取りでも）", () => {
		const p = position("b", "....k", ".....", ".....", "p....", ".N..K");
		const after = applyMove(p, move(p, "a2", "b1"));
		expect(pieceAt(after.board, square("b1"))).toEqual({
			color: "b",
			type: "Q",
		});
	});
});

describe("詰み・ステイルメイト・50手引き分け", () => {
	it("詰み: 王手で、どの手でも外せない", () => {
		// 黒キング a5 に白クイーン b4 が王手。クイーンは白キング c3 が守っている。
		const p = position("b", "k....", ".Q...", "..K..", ".....", ".....");
		expect(status(p)).toEqual({ kind: "checkmate", winner: "w" });
	});

	it("ステイルメイト: 王手ではないが、指せる手が無い", () => {
		const p = position("b", "k....", ".....", ".Q...", "..K..", ".....");
		expect(inCheck(p, "b")).toBe(false);
		expect(status(p)).toEqual({ kind: "stalemate" });
	});

	it(`ポーンの動きも取りも無い手が ${FIFTY_MOVE_PLIES} 手（双方50手）続くと引き分け`, () => {
		const p: Position = {
			...position("w", "...k.", ".....", ".....", ".....", "K...R"),
			halfmoveClock: FIFTY_MOVE_PLIES,
		};
		expect(status(p)).toEqual({ kind: "fifty-move" });
		expect(status({ ...p, halfmoveClock: FIFTY_MOVE_PLIES - 1 }).kind).toBe(
			"playing",
		);
	});

	it("ポーンの動きと取りで数え直し、それ以外の手で1つ増える", () => {
		const p: Position = {
			...position("w", "....k", "....p", ".....", "..P..", "K...R"),
			halfmoveClock: 10,
		};
		expect(applyMove(p, move(p, "e1", "e2")).halfmoveClock).toBe(11);
		expect(applyMove(p, move(p, "c2", "c3")).halfmoveClock).toBe(0);
		expect(applyMove(p, move(p, "e1", "e4")).halfmoveClock).toBe(0);
	});

	it("指したら手番が替わる。元の局面は変えない", () => {
		const p = initialPosition();
		const after = applyMove(p, move(p, "c2", "c3"));
		expect(after.turn).toBe("b");
		expect(pieceAt(p.board, square("c2"))).toEqual({ color: "w", type: "P" });
	});

	it("対局中は playing で、王手かどうかも分かる", () => {
		expect(status(initialPosition())).toEqual({
			kind: "playing",
			check: false,
		});
		const p = position("w", "..r.k", ".....", ".....", "...B.", "..K..");
		expect(status(p)).toEqual({ kind: "playing", check: true });
	});
});
