/**
 * link（内部名 nikaku-keshi / 二角消去）の盤面の規則（issue-37）。画面から切り離した純粋な関数。
 *
 * 同じ種類の牌を2枚、2回以内の折れ線（直線を含む）で結べるときに消す。経路は空きマスと、
 * 盤面の外周の外側（1マス分）だけを通れ、他の牌の上は通れない。乱数は引数で受け取る。
 */

/** 盤面の列数・行数（スマホの縦画面に合わせて縦長）。 */
export const COLS = 6;
export const ROWS = 8;
/** 牌の種類の数。各種類4枚ずつ（12種類 × 4枚 = 48枚 = 6 × 8）。 */
export const KINDS = 12;
const COPIES = 4;

/** 牌の種類（0 〜 KINDS-1）。null は空き。 */
export type Tile = number | null;
/** board[y][x]。 */
export type Board = readonly (readonly Tile[])[];

export interface Cell {
	readonly x: number;
	readonly y: number;
}

export type Pair = readonly [Cell, Cell];

/** 乱数。0 以上 1 未満を返す。 */
export type Random = () => number;

/** 配置やシャッフルで、消せるペアがある並びを探す回数の上限。 */
const MAX_ATTEMPTS = 100;

const DIRECTIONS: readonly Cell[] = [
	{ x: 1, y: 0 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 0, y: -1 },
];

function width(board: Board): number {
	return board[0]?.length ?? 0;
}

function tileAt(board: Board, cell: Cell): Tile {
	return board[cell.y]?.[cell.x] ?? null;
}

function same(a: Cell, b: Cell): boolean {
	return a.x === b.x && a.y === b.y;
}

/** 経路が通れるマスか。空きマスと、外周の外側1マス分。 */
function passable(board: Board, cell: Cell): boolean {
	const inside =
		cell.x >= 0 &&
		cell.x < width(board) &&
		cell.y >= 0 &&
		cell.y < board.length;
	if (inside) return tileAt(board, cell) === null;
	return (
		cell.x >= -1 &&
		cell.x <= width(board) &&
		cell.y >= -1 &&
		cell.y <= board.length
	);
}

/**
 * a と b を、2回以内の折れ線で結べるか。同じ種類の牌どうしで、経路は空きマスと外周の
 * 外側だけを通る。始点からまっすぐ伸ばし、届いたマスから直角に曲がってまた伸ばす。
 */
export function canConnect(board: Board, a: Cell, b: Cell): boolean {
	const kind = tileAt(board, a);
	if (kind === null || same(a, b) || tileAt(board, b) !== kind) return false;

	// [マス, 進んでいる向き] を、曲がった回数ごとに広げる。
	let frontier: { cell: Cell; dir: Cell }[] = [
		{ cell: a, dir: { x: 0, y: 0 } },
	];
	for (let turns = 0; turns <= 2; turns++) {
		const next: { cell: Cell; dir: Cell }[] = [];
		for (const { cell, dir } of frontier) {
			for (const d of DIRECTIONS) {
				// 最初は4方向、以後は今の向きと直角な向きにだけ曲がる。
				if (
					turns > 0 &&
					(d.x === dir.x || d.x === -dir.x) &&
					(d.y === dir.y || d.y === -dir.y)
				) {
					continue;
				}
				let step = { x: cell.x + d.x, y: cell.y + d.y };
				while (true) {
					if (same(step, b)) return true;
					if (!passable(board, step)) break;
					next.push({ cell: step, dir: d });
					step = { x: step.x + d.x, y: step.y + d.y };
				}
			}
		}
		frontier = next;
	}
	return false;
}

/** 残っている牌の位置（左上から順に）。 */
function tiles(board: Board): Cell[] {
	const cells: Cell[] = [];
	board.forEach((row, y) => {
		row.forEach((tile, x) => {
			if (tile !== null) cells.push({ x, y });
		});
	});
	return cells;
}

/** 今消せるペアを1組返す。無ければ null。左上から順に探すので結果は決まる。 */
export function findPair(board: Board): Pair | null {
	const cells = tiles(board);
	for (let i = 0; i < cells.length; i++) {
		for (let j = i + 1; j < cells.length; j++) {
			const a = cells[i];
			const b = cells[j];
			if (a !== undefined && b !== undefined && canConnect(board, a, b)) {
				return [a, b];
			}
		}
	}
	return null;
}

/** 全部消えたか。 */
export function isCleared(board: Board): boolean {
	return tiles(board).length === 0;
}

/** 牌が残っているのに、消せるペアが無い（詰み）。 */
export function isStuck(board: Board): boolean {
	return !isCleared(board) && findPair(board) === null;
}

/** 2枚を空きにした新しい盤面。 */
export function remove(board: Board, pair: Pair): Board {
	return board.map((row, y) =>
		row.map((tile, x) =>
			pair.some((cell) => cell.x === x && cell.y === y) ? null : tile,
		),
	);
}

function shuffled<T>(items: readonly T[], random: Random): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const a = result[i];
		const b = result[j];
		if (a === undefined || b === undefined) continue;
		result[i] = b;
		result[j] = a;
	}
	return result;
}

/** 牌の並びを盤面に置く（空きの位置はそのまま）。 */
function place(board: Board, kinds: readonly number[]): Board {
	let next = 0;
	return board.map((row) =>
		row.map((tile) => {
			if (tile === null) return null;
			const kind = kinds[next] ?? tile;
			next += 1;
			return kind;
		}),
	);
}

/**
 * 初期配置。各種類を4枚（2ペア）ずつ並べてから混ぜる。開始時に消せるペアが1組以上ある
 * ことを保証する（無ければ混ぜ直す）。
 */
export function createBoard(random: Random): Board {
	const kinds = Array.from({ length: KINDS * COPIES }, (_, i) =>
		Math.floor(i / COPIES),
	);
	const empty: Board = Array.from({ length: ROWS }, () =>
		Array.from({ length: COLS }, (): Tile => 0),
	);
	let board = place(empty, shuffled(kinds, random));
	for (
		let attempt = 0;
		attempt < MAX_ATTEMPTS && findPair(board) === null;
		attempt++
	) {
		board = place(empty, shuffled(kinds, random));
	}
	return board;
}

/**
 * 残っている牌を並べ替える（空きの位置と、牌の種類・枚数は変えない）。消せるペアが
 * 1組以上ある並びになるまでやり直し、上限まで見つからなければ ok=false で元の盤面を返す。
 */
export function shuffle(
	board: Board,
	random: Random,
): { readonly board: Board; readonly ok: boolean } {
	const kinds = board.flat().filter((tile): tile is number => tile !== null);
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const candidate = place(board, shuffled(kinds, random));
		if (findPair(candidate) !== null) return { board: candidate, ok: true };
	}
	return { board, ok: false };
}
