import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import {
	SHOT_RANGE,
	lineBlocker,
	missHint,
	missText,
	shotLogMessage,
} from "./shotHint";
import { type Cell, edgeKey, parseStageNotice } from "./stage";

const grid = parseStageNotice(hirayaFixture.stage);
if (grid === null) throw new Error("平屋の見本が読めない");

/** マス（列, 行）の中心。 */
const at = (x: number, z: number) => ({
	x: grid.origin.x + grid.cellSize * (x + 0.5),
	z: grid.origin.z + grid.cellSize * (z + 0.5),
});

/** 戸の一覧のうち、2つの領域の間の襖の鍵すべて（1組）。 */
const fusumaBetween = (a: string, b: string): Set<string> =>
	new Set(
		grid.doorList
			.filter((door) => door.kind === "fusuma")
			.filter((door) => {
				const pair = [grid.regionAt(door.a), grid.regionAt(door.b)];
				return pair.includes(a) && pair.includes(b);
			})
			.map((door: { a: Cell; b: Cell }) => edgeKey(door.a, door.b)),
	);

describe("lineBlocker - 見通しを遮るもの（サーバーの grid.line_clear と同じ規則）", () => {
	it("同じ部屋の中は、遮るものが無い", () => {
		expect(lineBlocker(grid, new Set(), at(24, 28), at(30, 28))).toBeNull();
	});

	it("壁は、襖が全部開いていても遮る（和室A → 和室B）", () => {
		const all = new Set(
			grid.doorList
				.filter((d) => d.kind === "fusuma")
				.map((d) => edgeKey(d.a, d.b)),
		);
		expect(lineBlocker(grid, all, at(15, 15), at(15, 26))).toBe("wall");
	});

	it("閉じた襖は遮り、開けた襖は通す（和室B → 和室C）", () => {
		expect(lineBlocker(grid, new Set(), at(15, 28), at(26, 28))).toBe("fusuma");
		expect(
			lineBlocker(grid, fusumaBetween("B", "C"), at(15, 28), at(26, 28)),
		).toBeNull();
	});

	it("いつも開いている戸は通す（キッチン → ダイニング）", () => {
		expect(lineBlocker(grid, new Set(), at(26, 4), at(26, 14))).toBeNull();
	});

	it("閉じた襖の手前に壁があれば、手前のものを返す（線の上で最初に当たるもの）", () => {
		// 和室A (15,15) → ダイニング (26,15)：和室A-ダイニングの襖（列 20|21）。
		expect(lineBlocker(grid, new Set(), at(15, 15), at(26, 15))).toBe("fusuma");
		// 東の廊下 (34,22) → 和室C (26,22)：行 21〜23 の列 32|33 は壁。
		expect(lineBlocker(grid, new Set(), at(34, 22), at(26, 22))).toBe("wall");
	});
});

describe("missHint - 外れの理由の推定（表示だけ。判定はサーバー）", () => {
	const base = {
		grid,
		open: new Set<string>(),
		oni: at(24, 28),
		reloadMs: 0,
	};

	it("見える相手で、射程の内側なら、外れの理由は無い（null）", () => {
		expect(missHint({ ...base, target: at(30, 28) })).toBeNull();
	});

	it("狙った所に隠れている人がいなければ no-target", () => {
		expect(missHint({ ...base, target: null })).toBe("no-target");
	});

	it("間隔中なら、ほかより先に reload", () => {
		expect(missHint({ ...base, reloadMs: 100, target: null })).toBe("reload");
	});

	it("射程（8 m）より遠ければ range。ちょうど 8 m は内側", () => {
		expect(SHOT_RANGE).toBe(8);
		expect(
			missHint({ ...base, oni: at(1, 6), target: at(1, 40) }), // 10.2 m
		).toBe("range");
		const from = at(1, 6);
		expect(
			missHint({ ...base, oni: from, target: { x: from.x, z: from.z + 8 } }),
		).toBeNull();
	});

	it("壁越しは wall、閉じた襖越しは fusuma", () => {
		expect(missHint({ ...base, oni: at(15, 15), target: at(15, 26) })).toBe(
			"wall",
		);
		expect(missHint({ ...base, oni: at(15, 28), target: at(26, 28) })).toBe(
			"fusuma",
		);
	});

	it("ステージの地図が無い（待機ルームなど）ときは、射程だけを見る", () => {
		expect(
			missHint({
				...base,
				grid: null,
				oni: { x: 0, z: 0 },
				target: { x: 3, z: 0 },
			}),
		).toBeNull();
		expect(
			missHint({
				...base,
				grid: null,
				oni: { x: 0, z: 0 },
				target: { x: 9, z: 0 },
			}),
		).toBe("range");
	});
});

describe("missText - 画面に出す短い文", () => {
	it("理由ごとの文", () => {
		expect(missText("no-target")).toBe(
			"外れ: 狙った所に、隠れている人がいません",
		);
		expect(missText("reload")).toBe("外れ: 間隔中です");
		expect(missText("range")).toBe("外れ: 遠すぎます（8 m まで）");
		expect(missText("fusuma")).toBe("外れ: 襖が閉まっています");
		expect(missText("wall")).toBe("外れ: 壁の向こうです");
	});
});

describe("shotLogMessage - 開発中だけ Console に出す、射撃の結果", () => {
	it("狙った相手、推定、隠れ中の一覧の変化", () => {
		expect(
			shotLogMessage({
				target: "b",
				hint: null,
				before: ["b", "c"],
				after: ["c"],
			}),
		).toBe(
			"[veryare-shoot] 結果: target=b・推定=当たるはず・隠れている b, c → c（b が見つかった）",
		);
		expect(
			shotLogMessage({
				target: null,
				hint: "no-target",
				before: ["b"],
				after: ["b"],
			}),
		).toBe(
			"[veryare-shoot] 結果: target=なし・推定=no-target・隠れている b → b（変化なし）",
		);
	});
});
