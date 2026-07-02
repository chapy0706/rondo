import { describe, expect, it } from "vitest";
import { NEUTRAL } from "./port";
import { VirtualPadSource } from "./virtual-pad";

describe("VirtualPadSource", () => {
	it("starts neutral", () => {
		expect(new VirtualPadSource().read()).toEqual(NEUTRAL);
	});

	it("normalizes offset by radius into [-1, 1]", () => {
		const pad = new VirtualPadSource();
		pad.move(25, -50, 50);
		expect(pad.read()).toEqual({ x: 0.5, y: -1 });
	});

	it("clamps beyond the radius", () => {
		const pad = new VirtualPadSource();
		pad.move(100, -100, 50);
		expect(pad.read()).toEqual({ x: 1, y: -1 });
	});

	it("returns to neutral on release", () => {
		const pad = new VirtualPadSource();
		pad.move(30, 30, 50);
		pad.release();
		expect(pad.read()).toEqual(NEUTRAL);
	});

	it("notifies subscribers on change and stops after unsubscribe", () => {
		const pad = new VirtualPadSource();
		const seen: number[] = [];
		const unsubscribe = pad.subscribe((direction) => seen.push(direction.x));
		pad.move(50, 0, 50); // x = 1
		pad.move(50, 0, 50); // 変化なし: 通知されない
		unsubscribe();
		pad.move(0, 0, 50); // 解除後: 通知されない
		expect(seen).toEqual([1]);
	});
});
