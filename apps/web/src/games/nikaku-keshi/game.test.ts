import { describe, expect, it } from "vitest";
import { type Board, type Tile, createBoard } from "./board";
import {
	AUTO_SHUFFLE_LIMIT,
	type GameState,
	HINT_LIMIT,
	askHint,
	autoStep,
	canShuffle,
	hintLabel,
	manualShuffle,
	startGame,
	tap,
} from "./game";

function board(...rows: string[]): Board {
	return rows.map((row) =>
		Array.from(row).map((ch): Tile => (ch === "." ? null : Number(ch))),
	);
}

function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

const withBoard = (b: Board): GameState => startGame(b);

describe("tap - 1枚目と2枚目を選んで消す", () => {
	it("1枚目を選び、結べる2枚目で2枚とも消える", () => {
		let state = withBoard(board("1..1", "2222"));
		state = tap(state, { x: 0, y: 0 });
		expect(state.selected).toEqual({ x: 0, y: 0 });
		state = tap(state, { x: 3, y: 0 });
		expect(state.board).toEqual(board("....", "2222"));
		expect(state.selected).toBeNull();
	});

	it("結べない2枚目を選ぶと、選択を解除する（消えない）", () => {
		const start = withBoard(board("2222", "1221", "2222"));
		const state = tap(tap(start, { x: 0, y: 1 }), { x: 3, y: 1 });
		expect(state.board).toEqual(start.board);
		expect(state.selected).toBeNull();
	});

	it("同じ牌をもう一度押すと選択を解除し、空きマスは選べない", () => {
		const start = withBoard(board("1.1", "222"));
		expect(tap(tap(start, { x: 0, y: 0 }), { x: 0, y: 0 }).selected).toBeNull();
		expect(tap(start, { x: 1, y: 0 }).selected).toBeNull();
	});

	it("最後のペアを消すとクリアになる", () => {
		const state = tap(tap(withBoard(board("11")), { x: 0, y: 0 }), {
			x: 1,
			y: 0,
		});
		expect(state.mode).toBe("cleared");
	});
});

describe("askHint / hintLabel - お助け", () => {
	const start = withBoard(board("1..1", "2332"));

	it(`${HINT_LIMIT}回目までは、今消せるペアを1組示す`, () => {
		let state = start;
		for (let i = 1; i <= HINT_LIMIT; i++) {
			expect(hintLabel(state)).toContain("お助け");
			state = askHint(state);
			expect(state.hintsUsed).toBe(i);
			expect(state.highlight).not.toBeNull();
			expect(state.mode).toBe("playing");
		}
	});

	it(`${HINT_LIMIT + 1}回目からはボタンが「答えを見る」になり、押すと自動で消し始める`, () => {
		let state = start;
		for (let i = 0; i < HINT_LIMIT; i++) state = askHint(state);
		expect(hintLabel(state)).toBe("答えを見る");
		state = askHint(state);
		expect(state.mode).toBe("auto");
		expect(state.hintsUsed).toBe(HINT_LIMIT + 1);
	});

	it("詰んでいてペアを示せないときは、お助けの回数を使わない", () => {
		const stuck = withBoard(board("12", "21"));
		expect(askHint(stuck)).toBe(stuck);
	});

	it("示したペアは、牌を消すと消える", () => {
		let state = askHint(start);
		state = tap(tap(state, { x: 0, y: 0 }), { x: 3, y: 0 });
		expect(state.highlight).toBeNull();
	});
});

describe("canShuffle / manualShuffle - 詰みとシャッフル", () => {
	it("詰みのときだけシャッフルできる", () => {
		expect(canShuffle(withBoard(board("12", "21")))).toBe(true);
		expect(canShuffle(withBoard(board("11", "22")))).toBe(false);
	});

	it("シャッフルすると消せるペアができ、回数が数えられる", () => {
		const state = manualShuffle(withBoard(board("12", "21")), seeded(2));
		expect(canShuffle(state)).toBe(false);
		expect(state.shuffles).toBe(1);
	});

	it("詰んでいないときのシャッフルは何もしない", () => {
		const start = withBoard(board("11", "22"));
		expect(manualShuffle(start, seeded(2))).toBe(start);
	});
});

describe("autoStep - 答えを見る（自動で消す）", () => {
	/** お助けを使い切った状態から「答えを見る」を押す（詰んだ盤面でも入れる）。 */
	function auto(b: Board): GameState {
		return askHint({ ...withBoard(b), hintsUsed: HINT_LIMIT });
	}

	it("1歩ごとにペアを1組消し、全部消えたらクリアになる", () => {
		let state = auto(board("11", "22"));
		state = autoStep(state, seeded(1));
		expect(state.board.flat().filter((t) => t !== null)).toHaveLength(2);
		state = autoStep(state, seeded(1));
		expect(state.mode).toBe("cleared");
	});

	it("詰んだら自動でシャッフルして続ける", () => {
		const state = autoStep(auto(board("12", "21")), seeded(3));
		expect(state.mode).toBe("auto");
		expect(state.shuffles).toBe(1);
		expect(canShuffle({ ...state, mode: "playing" })).toBe(false);
	});

	it(`自動のシャッフルが上限（${AUTO_SHUFFLE_LIMIT}回）に達したら、理由を出して止まる`, () => {
		let state: GameState = {
			...auto(board("12", "21")),
			autoShuffles: AUTO_SHUFFLE_LIMIT,
		};
		state = autoStep(state, seeded(3));
		expect(state.mode).toBe("halted");
		expect(state.haltReason).toContain(`${AUTO_SHUFFLE_LIMIT}`);
	});

	it("自動で消している間は、タップを受け付けない", () => {
		const state = auto(board("11", "22"));
		expect(tap(state, { x: 0, y: 0 })).toBe(state);
	});

	it("自動でないときの autoStep は何もしない", () => {
		const state = withBoard(board("11", "22"));
		expect(autoStep(state, seeded(1))).toBe(state);
	});

	it("実際の初期配置でも、自動で消し続けると必ず終わる（クリアか、上限で停止）", () => {
		for (let seed = 1; seed <= 20; seed++) {
			const random = seeded(seed);
			let state = askHint({
				...startGame(createBoard(random)),
				hintsUsed: HINT_LIMIT,
			});
			let steps = 0;
			while (state.mode === "auto" && steps < 1000) {
				state = autoStep(state, random);
				steps += 1;
			}
			expect(["cleared", "halted"]).toContain(state.mode);
			expect(state.autoShuffles).toBeLessThanOrEqual(AUTO_SHUFFLE_LIMIT);
		}
	});
});
