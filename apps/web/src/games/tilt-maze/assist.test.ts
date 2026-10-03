import { describe, expect, it } from "vitest";
import {
	HINT_LIMIT,
	askHint,
	hintLabel,
	moveTo,
	revealStep,
	startProgress,
} from "./assist";
import type { Grid } from "./maze";

function grid(...rows: string[]): Grid {
	return rows.map((row) => Array.from(row).map((ch) => ch === "#"));
}

// 3×3 のつづら折り。最短経路は 9 マス（8 歩）。
const zigzag = grid(
	"#######",
	"#.....#",
	"#####.#",
	"#.....#",
	"#.#####",
	"#.....#",
	"#######",
);
const START = { cx: 0, cy: 0 };
const GOAL = { cx: 2, cy: 2 };

describe("moveTo - 通ったマス数を数える", () => {
	it("隣のマスへ移るたびに1つ増え、同じマスにいる間は増えない", () => {
		let p = startProgress(START);
		expect(p.steps).toBe(0);
		p = moveTo(p, { cx: 1, cy: 0 });
		p = moveTo(p, { cx: 1, cy: 0 });
		expect(p.steps).toBe(1);
		// 戻った分も数える（遠回りが差として見える）。
		p = moveTo(p, { cx: 0, cy: 0 });
		expect(p.steps).toBe(2);
		expect(p.cell).toEqual({ cx: 0, cy: 0 });
	});
});

describe("askHint / hintLabel - お助け", () => {
	it(`${HINT_LIMIT}回目までは、次に進むべきマスを1つ示す`, () => {
		let p = startProgress(START);
		for (let i = 1; i <= HINT_LIMIT; i++) {
			expect(hintLabel(p)).toContain("お助け");
			p = askHint(p, zigzag, GOAL);
			expect(p.hintsUsed).toBe(i);
			expect(p.hint).toEqual({ cx: 1, cy: 0 });
			expect(p.reveal).toBeNull();
		}
	});

	it("示すのは、今いるマスからの次のマス", () => {
		const p = askHint(
			moveTo(startProgress(START), { cx: 2, cy: 1 }),
			zigzag,
			GOAL,
		);
		expect(p.hint).toEqual({ cx: 1, cy: 1 });
	});

	it("示したマスに入ると、その印は消える", () => {
		let p = askHint(startProgress(START), zigzag, GOAL);
		p = moveTo(p, { cx: 1, cy: 0 });
		expect(p.hint).toBeNull();
	});

	it(`${HINT_LIMIT + 1}回目からは「答えを見る」になり、押すと最短経路を示し始める`, () => {
		let p = startProgress(START);
		for (let i = 0; i < HINT_LIMIT; i++) p = askHint(p, zigzag, GOAL);
		expect(hintLabel(p)).toBe("答えを見る");
		p = askHint(p, zigzag, GOAL);
		expect(p.hintsUsed).toBe(HINT_LIMIT + 1);
		expect(p.hint).toBeNull();
		expect(p.reveal?.path).toHaveLength(9);
		// 押した直後は、今いるマスだけが見えている。
		expect(p.reveal?.shown).toBe(1);
	});

	it("答えを見ている間は、もう一度押しても何も変わらない", () => {
		let p = { ...startProgress(START), hintsUsed: HINT_LIMIT };
		p = askHint(p, zigzag, GOAL);
		expect(askHint(p, zigzag, GOAL)).toBe(p);
	});
});

describe("revealStep - 最短経路を1マスずつ示す", () => {
	it("1歩ごとに1マス増え、ゴールまで示したらそれ以上増えない", () => {
		let p = askHint(
			{ ...startProgress(START), hintsUsed: HINT_LIMIT },
			zigzag,
			GOAL,
		);
		for (let i = 2; i <= 9; i++) {
			p = revealStep(p);
			expect(p.reveal?.shown).toBe(i);
		}
		expect(revealStep(p)).toBe(p);
	});

	it("答えを見ていないときは何もしない", () => {
		const p = startProgress(START);
		expect(revealStep(p)).toBe(p);
	});
});
