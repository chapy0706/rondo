import { describe, expect, it } from "vitest";
import {
	PROPS_READY,
	PROP_KINDS,
	PROP_MAX_HEIGHT,
	PROP_MAX_SPAN,
	PROP_SIZES,
	ROAMING_PROPS,
	lowProp,
	propsEnabled,
	propsForRoom,
} from "./roomProps";

describe("旗 PROPS_READY と、開発用の合図（issue-72）", () => {
	it("旗の既定は false。旗も合図も無ければ、小物を出さない（差し替え口を作らず、何も読まない）", () => {
		expect(PROPS_READY).toBe(false);
		expect(propsEnabled(PROPS_READY, false, "")).toBe(false);
		expect(propsEnabled(PROPS_READY, false, "?rules=1")).toBe(false);
		expect(propsEnabled(PROPS_READY, false, "?roof=0")).toBe(false);
	});

	it("開発用の合図（NEXT_PUBLIC_VERYARE_HIRAYA か ?roof=1）か、旗が true なら出す", () => {
		expect(propsEnabled(false, true, "")).toBe(true);
		expect(propsEnabled(false, false, "?roof=1")).toBe(true);
		expect(propsEnabled(true, false, "")).toBe(true);
	});
});

describe("第 1 段階の条件（高さ 0.55 m 以下、上から見た長い辺 1.0 m 以下）", () => {
	it("上限は、寝る体の高さの上の端と、寝た体を覆えない長さ", () => {
		expect(PROP_MAX_HEIGHT).toBe(0.55);
		expect(PROP_MAX_SPAN).toBe(1.0);
	});

	it("決めた 4 種は、どれも条件に合う。座卓和風（2.1 m）と、背の高い家具は合わない", () => {
		expect([...PROP_KINDS]).toEqual(["chabudai", "zaisu", "tsubo", "yunomi"]);
		for (const kind of PROP_KINDS)
			expect(lowProp(PROP_SIZES[kind]), kind).toBe(true);
		expect(lowProp({ width: 0.9, depth: 2.1, height: 0.41 })).toBe(false);
		expect(lowProp({ width: 1.0, depth: 0.42, height: 0.9 })).toBe(false);
	});
});

describe("動ける隠れ側の規則のルームでは、小物を出す（旗 ROAMING_PROPS）", () => {
	it("旗 ROAMING_PROPS の既定は true。動けるルームなら、URL の合図が無くても出す", () => {
		expect(ROAMING_PROPS).toBe(true);
		expect(propsForRoom(false, true)).toBe(true);
	});

	it("従来の規則のルームでは、これまでどおり、旗 PROPS_READY か開発用の合図のときだけ", () => {
		expect(propsForRoom(false, false)).toBe(false);
		expect(propsForRoom(true, false)).toBe(true);
	});

	it("旗 ROAMING_PROPS を false にすると、動けるルームでも、これまでどおり（1 行で切れる）", () => {
		expect(propsForRoom(false, true, false)).toBe(false);
		expect(propsForRoom(true, true, false)).toBe(true);
	});
});
