import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import palette from "../../../../../packages/contracts/src/fixtures/veryare-palette.json";
import {
	FLOOR_COLOR,
	ROOM_COLORS,
	UNPAINTED_COLOR,
	placeColor,
} from "./palette";
import { parseStageNotice } from "./stage";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");

describe("部屋タイプの代表色（issue-29c。床の色と、ペイントの代表色 issue-25 が同じ表を使う）", () => {
	it("共有の見本（サーバーの palette.gleam と一致することは、サーバーのテストが確かめる）と同じ値", () => {
		expect(FLOOR_COLOR).toBe(palette.floor);
		expect(UNPAINTED_COLOR).toBe(palette.unpainted);
		expect(ROOM_COLORS).toEqual(palette.rooms);
	});

	it("その場の代表色: 部屋の中はその部屋タイプの色、廊下は廊下の色（palette.gleam の place_color と同じ）", () => {
		expect(placeColor(tiny, { x: 2, z: 0 })).toBe(palette.rooms.washitsu);
		expect(placeColor(tiny, { x: 2, z: 3 })).toBe(palette.rooms.oshiire);
		expect(placeColor(tiny, { x: 0, z: 0 })).toBe(palette.floor);
	});

	it("知らない部屋タイプは、廊下の色にする", () => {
		const odd = parseStageNotice({
			...movement.stage,
			rooms: { A: "garden", B: "oshiire" },
		});
		if (odd === null) throw new Error("読めない");
		expect(placeColor(odd, { x: 2, z: 0 })).toBe(palette.floor);
	});
});
