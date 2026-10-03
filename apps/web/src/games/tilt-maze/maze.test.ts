import { describe, expect, it } from "vitest";
import {
	type Grid,
	type MazeCell,
	createUnionFind,
	generateMaze,
	openNeighbors,
	seededRandom,
	shortestPath,
} from "./maze";

/** 図から迷路を作る。"#" が壁、"." が通路。 */
function grid(...rows: string[]): Grid {
	return rows.map((row) => Array.from(row).map((ch) => ch === "#"));
}

/** (0,0) から辿れるマスの数。 */
function reachable(g: Grid, cols: number, rows: number): number {
	const seen = new Set(["0,0"]);
	const stack: MazeCell[] = [{ cx: 0, cy: 0 }];
	while (stack.length > 0) {
		const cell = stack.pop();
		if (cell === undefined) break;
		for (const next of openNeighbors(g, cell)) {
			const key = `${next.cx},${next.cy}`;
			if (seen.has(key)) continue;
			seen.add(key);
			stack.push(next);
		}
	}
	expect(seen.size).toBeLessThanOrEqual(cols * rows);
	return seen.size;
}

/** マスどうしの間の通路の数。 */
function passages(g: Grid, cols: number, rows: number): number {
	let count = 0;
	for (let cy = 0; cy < rows; cy++) {
		for (let cx = 0; cx < cols; cx++) {
			if (cx + 1 < cols && g[2 * cy + 1]?.[2 * cx + 2] === false) count++;
			if (cy + 1 < rows && g[2 * cy + 2]?.[2 * cx + 1] === false) count++;
		}
	}
	return count;
}

describe("createUnionFind - ユニオンファインド", () => {
	it("つなぐと同じ組になり、もうつながっている組は二度つながない", () => {
		const uf = createUnionFind(4);
		expect(uf.find(0)).not.toBe(uf.find(1));
		expect(uf.union(0, 1)).toBe(true);
		expect(uf.union(2, 3)).toBe(true);
		expect(uf.find(0)).toBe(uf.find(1));
		expect(uf.find(1)).not.toBe(uf.find(2));
		expect(uf.union(1, 3)).toBe(true);
		expect(uf.find(0)).toBe(uf.find(2));
		// 既に同じ組なので false（迷路では、ここで壁を壊すと輪ができる）。
		expect(uf.union(0, 3)).toBe(false);
	});
});

describe("generateMaze - クラスカル法で迷路を作る", () => {
	const sizes = [
		[5, 5],
		[8, 8],
		[11, 11],
		[3, 7],
	] as const;

	it("全てのマスがつながっている（どのマスからもゴールに着ける）", () => {
		for (const [cols, rows] of sizes) {
			for (let seed = 1; seed <= 20; seed++) {
				const g = generateMaze(cols, rows, seededRandom(seed));
				expect(reachable(g, cols, rows)).toBe(cols * rows);
			}
		}
	});

	it("輪が無い（通路の数がマス数 − 1 の、木の形の迷路）", () => {
		for (const [cols, rows] of sizes) {
			const g = generateMaze(cols, rows, seededRandom(7));
			expect(passages(g, cols, rows)).toBe(cols * rows - 1);
		}
	});

	it("大きさは (2×列+1) × (2×行+1) で、外周は壁", () => {
		const g = generateMaze(5, 3, seededRandom(1));
		expect(g).toHaveLength(7);
		for (const row of g) expect(row).toHaveLength(11);
		expect(g[0]?.every((wall) => wall)).toBe(true);
		expect(g[6]?.every((wall) => wall)).toBe(true);
		expect(g.every((row) => row[0] === true && row[10] === true)).toBe(true);
	});

	it("同じ seed なら同じ迷路、違う seed なら違う迷路", () => {
		expect(generateMaze(8, 8, seededRandom(42))).toEqual(
			generateMaze(8, 8, seededRandom(42)),
		);
		expect(generateMaze(8, 8, seededRandom(42))).not.toEqual(
			generateMaze(8, 8, seededRandom(43)),
		);
	});
});

describe("shortestPath - 幅優先探索で最短経路を求める", () => {
	// 3×3 のつづら折り。手で辿ると (0,0)→(2,0)→(2,1)→(0,1)→(0,2)→(2,2) の 9 マス。
	const zigzag = grid(
		"#######",
		"#.....#",
		"#####.#",
		"#.....#",
		"#.#####",
		"#.....#",
		"#######",
	);

	it("手で確かめた小さな迷路の答えと一致する", () => {
		expect(shortestPath(zigzag, { cx: 0, cy: 0 }, { cx: 2, cy: 2 })).toEqual([
			{ cx: 0, cy: 0 },
			{ cx: 1, cy: 0 },
			{ cx: 2, cy: 0 },
			{ cx: 2, cy: 1 },
			{ cx: 1, cy: 1 },
			{ cx: 0, cy: 1 },
			{ cx: 0, cy: 2 },
			{ cx: 1, cy: 2 },
			{ cx: 2, cy: 2 },
		]);
	});

	it("近道があれば、そちらを通る（遠回りの道は選ばない）", () => {
		// 右下に (2,1)-(2,2) の近道を開けると、5 マスで着く。
		const shortcut = grid(
			"#######",
			"#.....#",
			"#####.#",
			"#.....#",
			"#.###.#",
			"#.....#",
			"#######",
		);
		expect(shortestPath(shortcut, { cx: 0, cy: 0 }, { cx: 2, cy: 2 })).toEqual([
			{ cx: 0, cy: 0 },
			{ cx: 1, cy: 0 },
			{ cx: 2, cy: 0 },
			{ cx: 2, cy: 1 },
			{ cx: 2, cy: 2 },
		]);
	});

	it("途中から探しても、そこからの最短経路になる", () => {
		expect(shortestPath(zigzag, { cx: 1, cy: 1 }, { cx: 2, cy: 2 })).toEqual([
			{ cx: 1, cy: 1 },
			{ cx: 0, cy: 1 },
			{ cx: 0, cy: 2 },
			{ cx: 1, cy: 2 },
			{ cx: 2, cy: 2 },
		]);
	});

	it("スタートがゴールならそのマスだけ、着けなければ null", () => {
		expect(shortestPath(zigzag, { cx: 2, cy: 2 }, { cx: 2, cy: 2 })).toEqual([
			{ cx: 2, cy: 2 },
		]);
		const closed = grid("#####", "#.#.#", "#####");
		expect(shortestPath(closed, { cx: 0, cy: 0 }, { cx: 1, cy: 0 })).toBeNull();
	});

	it("生成した迷路でも、スタートからゴールまでの経路が見つかり、隣り合うマスを辿る", () => {
		const g = generateMaze(11, 11, seededRandom(3));
		const path = shortestPath(g, { cx: 0, cy: 0 }, { cx: 10, cy: 10 });
		expect(path).not.toBeNull();
		if (path === null) return;
		expect(path[0]).toEqual({ cx: 0, cy: 0 });
		expect(path.at(-1)).toEqual({ cx: 10, cy: 10 });
		for (let i = 1; i < path.length; i++) {
			const prev = path[i - 1];
			const cell = path[i];
			if (prev === undefined || cell === undefined) continue;
			expect(openNeighbors(g, prev)).toContainEqual(cell);
		}
	});
});
