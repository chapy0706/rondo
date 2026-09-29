import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./parse";

describe("parseServerMessage - game-state-to（限定配信 / ADR 0021）", () => {
	const valid = {
		type: "game-state-to",
		gameType: "chameleon",
		roomId: "room-1",
		to: "p1",
		payload: { type: "positions", seen: [] },
	};

	it("宛先付きの限定配信を通す（payload はゲーム側で検証するため unknown のまま）", () => {
		expect(parseServerMessage(valid)).toEqual(valid);
	});

	it.each(["gameType", "roomId", "to"])(
		"%s が文字列でなければ捨てる",
		(key) => {
			expect(parseServerMessage({ ...valid, [key]: 1 })).toBeNull();
		},
	);

	it("既存の game-state はこれまでどおり通す", () => {
		const broadcast = {
			type: "game-state",
			gameType: "tilt-maze",
			roomId: "room-1",
			payload: { type: "rank" },
		};
		expect(parseServerMessage(broadcast)).toEqual(broadcast);
	});
});
