import { describe, expect, it } from "vitest";
import { IDLE_PAD, type PadState, padReducer } from "./pad-state";

const R = 60;
const run = (events: Parameters<typeof padReducer>[1][], deadZone = 0) =>
	events.reduce<PadState>(
		(state, event) => padReducer(state, event, deadZone),
		IDLE_PAD,
	);

describe("padReducer - 仮想パッドの状態（指ごと / ADR 0018）", () => {
	it("触ったら、中心からのずれを半径で割った向きになる。つまみも同じ所へ", () => {
		const s = run([{ type: "down", pointerId: 1, x: 30, y: -60, radius: R }]);
		expect(s.vector).toEqual({ x: 0.5, y: -1 });
		expect(s.knob).toEqual({ x: 0.5, y: -1 });
		expect(s.pointerId).toBe(1);
	});

	it("動かしたら追う。半径の外は 1 に丸める", () => {
		const s = run([
			{ type: "down", pointerId: 1, x: 0, y: 0, radius: R },
			{ type: "move", pointerId: 1, x: 120, y: 0, radius: R },
		]);
		expect(s.vector).toEqual({ x: 1, y: 0 });
	});

	it("離したら、向きは 0、つまみは中心。パッドの外で離しても同じ", () => {
		for (const at of [
			{ x: 10, y: 10 },
			{ x: 500, y: -400 },
		]) {
			const s = run([
				{ type: "down", pointerId: 1, x: 30, y: 0, radius: R },
				{ type: "up", pointerId: 1 },
			]);
			expect(s).toEqual(IDLE_PAD);
			void at;
		}
	});

	it("取り消し・キャプチャを失った・全部を戻す（画面が隠れた、フォーカスを失った、消えた）は、0 に戻す", () => {
		for (const last of [
			{ type: "cancel", pointerId: 1 } as const,
			{ type: "lost", pointerId: 1 } as const,
			{ type: "reset" } as const,
		]) {
			expect(
				run([{ type: "down", pointerId: 1, x: 30, y: 0, radius: R }, last]),
			).toEqual(IDLE_PAD);
		}
	});

	it("2本目の指は、1本目が触っている間は無視する（1本目の向きのまま。2本目を離しても変わらない）", () => {
		const s = run([
			{ type: "down", pointerId: 1, x: 30, y: 0, radius: R },
			{ type: "down", pointerId: 2, x: -60, y: 0, radius: R },
			{ type: "move", pointerId: 2, x: -60, y: 60, radius: R },
			{ type: "up", pointerId: 2 },
		]);
		expect(s.vector).toEqual({ x: 0.5, y: 0 });
		expect(s.pointerId).toBe(1);
	});

	it("触っていない指の移動は、向きを変えない", () => {
		expect(
			run([{ type: "move", pointerId: 7, x: 60, y: 0, radius: R }]),
		).toEqual(IDLE_PAD);
	});

	it("小さな傾き（デッドゾーンより内側）は、向き 0。つまみは指に付いていく", () => {
		const s = run(
			[{ type: "down", pointerId: 1, x: 6, y: 0, radius: R }],
			0.15,
		);
		expect(s.vector).toEqual({ x: 0, y: 0 });
		expect(s.knob).toEqual({ x: 0.1, y: 0 });
	});

	it("デッドゾーンの外は、端まで 0〜1 に伸ばし直す（傾け始めで急に動かない）", () => {
		const s = run(
			[{ type: "down", pointerId: 1, x: 60, y: 0, radius: R }],
			0.2,
		);
		expect(s.vector.x).toBeCloseTo(1, 9);
		const mid = run(
			[{ type: "down", pointerId: 1, x: 36, y: 0, radius: R }],
			0.2,
		);
		expect(mid.vector.x).toBeCloseTo(0.5, 9);
	});

	it("半径が 0 以下なら、触っても 0", () => {
		expect(
			run([{ type: "down", pointerId: 1, x: 30, y: 0, radius: 0 }]).vector,
		).toEqual({ x: 0, y: 0 });
	});
});
