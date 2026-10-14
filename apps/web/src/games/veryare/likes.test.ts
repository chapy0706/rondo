import { describe, expect, it } from "vitest";
import missedFixture from "../../../../../packages/contracts/src/fixtures/veryare-missed.json";
import {
	canLike,
	likeEvent,
	parseLikesNotice,
	revealTargets,
	stepRevealTarget,
} from "./likes";

describe("parseLikesNotice - いいねの数の通知の境界の検証（issue-32）", () => {
	it("共有の見本の valid を読み、invalid を拒む", () => {
		expect(parseLikesNotice(missedFixture.likesNotice.valid[1])).toEqual(
			new Map([
				["p-2", 2],
				["p-3", 0],
			]),
		);
		expect(parseLikesNotice(missedFixture.likesNotice.valid[0])).toEqual(
			new Map(),
		);
		for (const sample of missedFixture.likesNotice.invalid) {
			expect(parseLikesNotice(sample)).toBeNull();
		}
	});

	it("負の数・小数・無限大は拒む", () => {
		for (const count of [-1, 1.5, Number.POSITIVE_INFINITY]) {
			expect(
				parseLikesNotice({ type: "likes", likes: [{ playerId: "p", count }] }),
			).toBeNull();
		}
	});
});

describe("答え合わせの視点の切り替え（issue-32 / ADR 0036）", () => {
	const hiders = [{ playerId: "b" }, { playerId: "c" }, { playerId: "d" }];

	it("切り替える先は、探索の開始に届いた隠れ側全員（自分を含む。届いた順）", () => {
		expect(revealTargets(hiders)).toEqual(["b", "c", "d"]);
		expect(revealTargets(null)).toEqual([]);
	});

	it("次へ・前へで、隠れ場所を順に回る。自分の視点（null）からは、先頭か末尾へ", () => {
		const targets = revealTargets(hiders);
		expect(stepRevealTarget(targets, null, 1)).toBe("b");
		expect(stepRevealTarget(targets, null, -1)).toBe("d");
		expect(stepRevealTarget(targets, "b", 1)).toBe("c");
		expect(stepRevealTarget(targets, "d", 1)).toBe("b");
		expect(stepRevealTarget(targets, "b", -1)).toBe("d");
	});

	it("切り替える先が無ければ、自分の視点のまま。一覧に無い人を見ていたら、先頭から", () => {
		expect(stepRevealTarget([], null, 1)).toBeNull();
		expect(stepRevealTarget(["b", "c"], "z", 1)).toBe("b");
	});
});

describe("canLike - いいねを送れるか", () => {
	const base = {
		phase: "reveal" as const,
		target: "c",
		you: "b",
		liked: new Set<string>(),
	};

	it("答え合わせの間、見ている隠れ側（自分以外）へ、まだ送っていなければ送れる", () => {
		expect(canLike(base)).toBe(true);
	});

	it("自分自身・送ったあと・見ていない・答え合わせの外では、送れない", () => {
		expect(canLike({ ...base, target: "b" })).toBe(false);
		expect(canLike({ ...base, liked: new Set(["c"]) })).toBe(false);
		expect(canLike({ ...base, target: null })).toBe(false);
		expect(canLike({ ...base, phase: "exploration" })).toBe(false);
		expect(canLike({ ...base, phase: "ended" })).toBe(false);
	});
});

describe("likeEvent - いいねの電文", () => {
	it("契約の VeryareLikeEvent の形（共有の見本と同じ）", () => {
		expect(likeEvent("p-2")).toEqual(missedFixture.like.valid[0]);
	});
});
