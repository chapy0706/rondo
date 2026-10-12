import { describe, expect, it } from "vitest";
import {
	AIM_TOLERANCE,
	TAP_MAX_MOVE_PX,
	TAP_MAX_MS,
	createTapTracker,
	hiderAt,
	rayHitsBody,
	shotMessage,
	shotTarget,
	toNdc,
} from "./aim";

describe("createTapTracker - タップとドラッグを分ける（指ごと。同時のタッチでも壊れない）", () => {
	it("短く、あまり動かないものだけをタップとする", () => {
		const taps = createTapTracker();
		taps.down(1, { x: 100, y: 100 }, 0);
		expect(taps.up(1, { x: 104, y: 103 }, 120)).toBe(true);
	});

	it("長く押したもの、大きく動いたものはタップでない", () => {
		const taps = createTapTracker();
		taps.down(1, { x: 0, y: 0 }, 0);
		expect(taps.up(1, { x: 0, y: 0 }, TAP_MAX_MS + 1)).toBe(false);
		taps.down(2, { x: 0, y: 0 }, 0);
		taps.move(2, { x: TAP_MAX_MOVE_PX + 1, y: 0 });
		expect(taps.up(2, { x: 0, y: 0 }, 50)).toBe(false);
	});

	it("指ごとに数える。移動しながら別の指でタップしても、タップになる", () => {
		const taps = createTapTracker();
		taps.down(1, { x: 0, y: 0 }, 0); // 移動の指（キャンバスの上で動かし続ける）
		taps.down(2, { x: 200, y: 200 }, 100);
		taps.move(1, { x: 80, y: 0 });
		expect(taps.up(2, { x: 201, y: 199 }, 180)).toBe(true);
		expect(taps.up(1, { x: 80, y: 0 }, 400)).toBe(false);
	});

	it("押していない指を離しても、取り消した指を離しても、タップでない", () => {
		const taps = createTapTracker();
		expect(taps.up(9, { x: 0, y: 0 }, 10)).toBe(false);
		taps.down(3, { x: 0, y: 0 }, 0);
		taps.cancel(3);
		expect(taps.up(3, { x: 0, y: 0 }, 10)).toBe(false);
	});
});

describe("toNdc - 画面の点を、-1〜1 の座標にする", () => {
	it("左上は (-1, 1)、右下は (1, -1)、中央は (0, 0)", () => {
		const rect = { left: 10, top: 20, width: 300, height: 400 };
		expect(toNdc({ x: 10, y: 20 }, rect)).toEqual({ x: -1, y: 1 });
		expect(toNdc({ x: 310, y: 420 }, rect)).toEqual({ x: 1, y: -1 });
		expect(toNdc({ x: 160, y: 220 }, rect)).toEqual({ x: 0, y: 0 });
	});
});

describe("rayHitsBody - 線と体（足もと feet から体の高さ 1.6 m、半径 0.2 m の円柱）の当たり", () => {
	const body = { x: 2, z: 0, feet: 0.6 };

	it("体の正面から水平に引いた線は、体の表面で当たる", () => {
		const t = rayHitsBody({ x: 0, y: 1.1, z: 0 }, { x: 1, y: 0, z: 0 }, body);
		expect(t).toBeCloseTo(1.8, 9);
	});

	it("体の上を通る線・後ろ向きの線は当たらない", () => {
		expect(
			rayHitsBody({ x: 0, y: 2.3, z: 0 }, { x: 1, y: 0, z: 0 }, body),
		).toBeNull();
		// 頭の少し下（足もと 0.6 + 1.6 = 2.2 m より下）は当たる。
		expect(
			rayHitsBody({ x: 0, y: 2.1, z: 0 }, { x: 1, y: 0, z: 0 }, body),
		).not.toBeNull();
		expect(
			rayHitsBody({ x: 0, y: 1.1, z: 0 }, { x: -1, y: 0, z: 0 }, body),
		).toBeNull();
	});

	it("床が高い所（足もと 0.6 m）でも、床から 0.1 m の所に当たる", () => {
		expect(
			rayHitsBody({ x: 0, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0 }, body),
		).not.toBeNull();
		expect(
			rayHitsBody({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, body),
		).toBeNull();
	});
});

describe("hiderAt - 狙う点にいる隠れ側を決める", () => {
	const hiders = [
		{ id: "b", x: 2, z: 0, feet: 0.6 },
		{ id: "c", x: 5, z: 5, feet: 0.4 },
	];

	it("狙う点が体の中（表面の少し外まで）にあれば、その隠れ側", () => {
		expect(hiderAt({ x: 1.8, y: 1.1, z: 0 }, hiders)).toBe("b");
		expect(
			hiderAt({ x: 2 - 0.2 - AIM_TOLERANCE + 1e-6, y: 1.1, z: 0 }, hiders),
		).toBe("b");
		expect(hiderAt({ x: 5, y: 0.5, z: 5.1 }, hiders)).toBe("c");
	});

	it("体の外（横・上・床の下）なら null（外れ）", () => {
		expect(hiderAt({ x: 1.5, y: 1.1, z: 0 }, hiders)).toBeNull();
		expect(hiderAt({ x: 2, y: 2.3, z: 0 }, hiders)).toBeNull();
		expect(hiderAt({ x: 2, y: 2.1, z: 0 }, hiders)).toBe("b");
		expect(hiderAt({ x: 2, y: 0.4, z: 0 }, hiders)).toBeNull();
	});
});

describe("shotTarget - 撃つときの相手", () => {
	const hiders = [{ id: "b", x: 2, z: 0, feet: 0 }];

	it("狙う点があれば、そこにいる隠れ側（いなければ null）。画面の中央は見ない", () => {
		let centerAsked = false;
		const center = () => {
			centerAsked = true;
			return "x";
		};
		expect(shotTarget({ x: 2, y: 0.5, z: 0.1 }, hiders, center)).toBe("b");
		expect(shotTarget({ x: 0, y: 0, z: 0 }, hiders, center)).toBeNull();
		expect(centerAsked).toBe(false);
	});

	it("狙う点がまだ無ければ、これまでどおり画面の中央", () => {
		expect(shotTarget(null, hiders, () => "c")).toBe("c");
		expect(shotTarget(null, hiders, () => null)).toBeNull();
	});
});

describe("shotMessage - 開発中だけ出す、申告の1行", () => {
	it("狙った相手と、狙いの決め方を出す", () => {
		expect(shotMessage({ target: "b", aim: { x: 1, y: 0.5, z: 2 } })).toBe(
			"[veryare-shoot] 申告を送った: target=b（狙う点 1.00, 0.50, 2.00）",
		);
		expect(shotMessage({ target: null, aim: null })).toBe(
			"[veryare-shoot] 申告を送った: target=null（画面の中央）",
		);
	});
});
