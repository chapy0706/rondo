/**
 * rolling の迷路の生成と最短経路（issue-39）。画面から切り離した純粋な関数。
 *
 * - 生成: クラスカル法。全ての壁を乱数で並べ、壁の両側のマスが別の組（ユニオンファインド）
 *   のときだけ壊す。輪ができず、全てのマスがつながった迷路（木の形）になる
 * - 最短経路: 幅優先探索。スタートから近い順にマスを広げ、ゴールに着いたら来た道を辿る
 *
 * 迷路は (2×列+1) × (2×行+1) の格子で持つ。true が壁。マス (cx, cy) は格子の
 * (2cx+1, 2cy+1) にあり、その間の格子が通路か壁かを表す。乱数は引数で受け取る。
 */

/** grid[gy][gx]。true なら壁。 */
export type Grid = readonly (readonly boolean[])[];

/** 迷路のマス（格子ではなく、通路のマスの位置）。 */
export interface MazeCell {
	readonly cx: number;
	readonly cy: number;
}

/** 乱数。0 以上 1 未満を返す。 */
export type Random = () => number;

/** seed で決まる乱数（同じ seed なら同じ列）。 */
export function seededRandom(seed: number): Random {
	let s = seed === 0 ? 1 : seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface UnionFind {
	/** 組の代表。 */
	find(i: number): number;
	/** a と b の組をつなぐ。別の組だったら true、既に同じ組なら false。 */
	union(a: number, b: number): boolean;
}

export function createUnionFind(size: number): UnionFind {
	const parent = Array.from({ length: size }, (_, i) => i);
	const find = (i: number): number => {
		let root = i;
		while (parent[root] !== root) root = parent[root] ?? root;
		// 経路圧縮。
		let node = i;
		while (parent[node] !== root) {
			const next = parent[node] ?? root;
			parent[node] = root;
			node = next;
		}
		return root;
	};
	return {
		find,
		union(a, b) {
			const ra = find(a);
			const rb = find(b);
			if (ra === rb) return false;
			parent[ra] = rb;
			return true;
		},
	};
}

/** 壊すかどうか調べる壁。a と b はその両側のマスの番号（cy × 列 + cx）。 */
interface Wall {
	readonly a: number;
	readonly b: number;
	readonly gx: number;
	readonly gy: number;
}

/** クラスカル法で、cols × rows マスの迷路を作る。 */
export function generateMaze(cols: number, rows: number, random: Random): Grid {
	const grid: boolean[][] = Array.from({ length: 2 * rows + 1 }, () =>
		Array.from({ length: 2 * cols + 1 }, () => true),
	);
	const open = (gx: number, gy: number) => {
		const row = grid[gy];
		if (row !== undefined) row[gx] = false;
	};

	const walls: Wall[] = [];
	for (let cy = 0; cy < rows; cy++) {
		for (let cx = 0; cx < cols; cx++) {
			open(2 * cx + 1, 2 * cy + 1);
			const id = cy * cols + cx;
			if (cx + 1 < cols) {
				walls.push({ a: id, b: id + 1, gx: 2 * cx + 2, gy: 2 * cy + 1 });
			}
			if (cy + 1 < rows) {
				walls.push({ a: id, b: id + cols, gx: 2 * cx + 1, gy: 2 * cy + 2 });
			}
		}
	}

	// 壁を乱数で並べる（フィッシャー–イェーツ）。
	for (let i = walls.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const wi = walls[i];
		const wj = walls[j];
		if (wi === undefined || wj === undefined) continue;
		walls[i] = wj;
		walls[j] = wi;
	}

	const sets = createUnionFind(cols * rows);
	for (const wall of walls) {
		// 両側がまだ別の組のときだけ壊す。同じ組なら壊すと輪ができる。
		if (sets.union(wall.a, wall.b)) open(wall.gx, wall.gy);
	}
	return grid;
}

const STEPS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
] as const;

/** 壁で隔てられていない、隣のマス。 */
export function openNeighbors(grid: Grid, cell: MazeCell): MazeCell[] {
	const gx = 2 * cell.cx + 1;
	const gy = 2 * cell.cy + 1;
	const result: MazeCell[] = [];
	for (const [dx, dy] of STEPS) {
		const passage = grid[gy + dy]?.[gx + dx];
		const next = grid[gy + 2 * dy]?.[gx + 2 * dx];
		if (passage === false && next === false) {
			result.push({ cx: cell.cx + dx, cy: cell.cy + dy });
		}
	}
	return result;
}

/**
 * 幅優先探索で、from から to までの最短経路（両端を含むマスの並び）を返す。
 * 着けなければ null。
 */
export function shortestPath(
	grid: Grid,
	from: MazeCell,
	to: MazeCell,
): MazeCell[] | null {
	const key = (cell: MazeCell) => `${cell.cx},${cell.cy}`;
	const cameFrom = new Map<string, MazeCell | null>([[key(from), null]]);
	const queue: MazeCell[] = [from];
	for (let head = 0; head < queue.length; head++) {
		const cell = queue[head];
		if (cell === undefined) break;
		if (cell.cx === to.cx && cell.cy === to.cy) {
			// 来た道を逆に辿る。
			const path: MazeCell[] = [];
			let node: MazeCell | null | undefined = cell;
			while (node != null) {
				path.unshift(node);
				node = cameFrom.get(key(node));
			}
			return path;
		}
		for (const next of openNeighbors(grid, cell)) {
			if (cameFrom.has(key(next))) continue;
			cameFrom.set(key(next), cell);
			queue.push(next);
		}
	}
	return null;
}
