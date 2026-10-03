import { describe, expect, it } from "vitest";
import {
	type Board,
	COLS,
	KINDS,
	ROWS,
	type Tile,
	canConnect,
	createBoard,
	findPair,
	isCleared,
	isStuck,
	remove,
	shuffle,
} from "./board";

/** 文字の図から盤面を作る。"." は空き、数字は牌の種類。 */
function board(...rows: string[]): Board {
	return rows.map((row) =>
		Array.from(row).map((ch): Tile => (ch === "." ? null : Number(ch))),
	);
}

/** 決まった列を返す乱数（テストで再現できるように）。 */
function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

const count = (b: Board) => b.flat().filter((t) => t !== null).length;

describe("canConnect - 2回以内の折れ線で結べるか", () => {
	it("隣り合う同じ牌は結べる（直線）", () => {
		const b = board("11", "..");
		expect(canConnect(b, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
	});

	it("間が空いた直線で結べる", () => {
		const b = board("1..1", "2222");
		expect(canConnect(b, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
	});

	it("1回折れで結べる", () => {
		const b = board("1..", "2.2", "2.1");
		expect(canConnect(b, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
	});

	it("2回折れで結べる", () => {
		// 1(0,1) → 上に出て → 右へ → 下りて 1(2,1)。間の (1,1) は塞がっている。
		const b = board("...", "121", "222");
		expect(canConnect(b, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(true);
	});

	it("盤面の外周の外側を通って結べる", () => {
		// 間はすべて塞がっているが、上の外側を回れば2回折れで届く。
		const b = board("1221", "2222");
		expect(canConnect(b, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
	});

	it("3回以上の折れが必要なら結べない", () => {
		// 1(1,1) から出られるのは右だけ。右 → 下 → 左 → 上 と3回折れないと 1(0,2) に届かない。
		const b = board("22222", "21.22", "12.22", "...22", "22222");
		expect(canConnect(b, { x: 1, y: 1 }, { x: 0, y: 2 })).toBe(false);
		// 通路の途中の牌を消して近道ができれば、2回以内で結べる。
		const opened = board("22222", "21.22", "1..22", "...22", "22222");
		expect(canConnect(opened, { x: 1, y: 1 }, { x: 0, y: 2 })).toBe(true);
	});

	it("他の牌を通り抜けることはできない", () => {
		const b = board("2222", "1221", "2222");
		expect(canConnect(b, { x: 0, y: 1 }, { x: 3, y: 1 })).toBe(false);
	});

	it("種類が違う牌・同じ位置・空きマスは結べない", () => {
		const b = board("12", "..");
		expect(canConnect(b, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
		expect(canConnect(b, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
		expect(canConnect(b, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false);
	});
});

describe("findPair / isStuck - 消せるペアと詰み", () => {
	it("消せるペアを1組見つける", () => {
		const b = board("1..1", "2332");
		const pair = findPair(b);
		expect(pair).not.toBeNull();
		if (pair === null) return;
		expect(canConnect(b, pair[0], pair[1])).toBe(true);
	});

	it("消せるペアが無ければ詰み", () => {
		// 市松模様。外周を回っても3回折れが要るので、どのペアも消せない。
		const b = board("12", "21");
		expect(findPair(b)).toBeNull();
		expect(isStuck(b)).toBe(true);
	});

	it("全部消えていれば詰みではなくクリア", () => {
		const b = board("..", "..");
		expect(isStuck(b)).toBe(false);
		expect(isCleared(b)).toBe(true);
	});

	it("remove は2枚を空きにする（元の盤面は変えない）", () => {
		const b = board("11", "22");
		const after = remove(b, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		]);
		expect(after).toEqual(board("..", "22"));
		expect(b).toEqual(board("11", "22"));
	});
});

describe("createBoard - 初期配置", () => {
	it(`${COLS}列×${ROWS}行に、${KINDS}種類が4枚ずつ並ぶ`, () => {
		const b = createBoard(seeded(1));
		expect(b).toHaveLength(ROWS);
		for (const row of b) expect(row).toHaveLength(COLS);
		const tiles = b.flat();
		expect(tiles).toHaveLength(KINDS * 4);
		for (let kind = 0; kind < KINDS; kind++) {
			expect(tiles.filter((t) => t === kind)).toHaveLength(4);
		}
	});

	it("どの乱数でも、開始時に消せるペアが1組以上ある", () => {
		for (let seed = 1; seed <= 200; seed++) {
			expect(findPair(createBoard(seeded(seed)))).not.toBeNull();
		}
	});

	it("同じ乱数なら同じ配置（再現できる）", () => {
		expect(createBoard(seeded(7))).toEqual(createBoard(seeded(7)));
	});
});

describe("shuffle - 残りの牌の並べ替え", () => {
	const stuck = board("12", "21");

	it("残っている牌の種類と枚数、空きの位置は変えない", () => {
		const result = shuffle(stuck, seeded(3));
		expect(result.ok).toBe(true);
		const sorted = (b: Board) =>
			b
				.flat()
				.filter((t) => t !== null)
				.sort();
		expect(sorted(result.board)).toEqual(sorted(stuck));
		expect(count(result.board)).toBe(count(stuck));
	});

	it("シャッフル後は、消せるペアが1組以上ある", () => {
		for (let seed = 1; seed <= 100; seed++) {
			const result = shuffle(stuck, seeded(seed));
			expect(result.ok).toBe(true);
			expect(findPair(result.board)).not.toBeNull();
		}
	});
});
