import { describe, expect, it } from "vitest";
import {
	type Control,
	type ControlsContext,
	NO_NOTICES,
	applyNotice,
	canMoveNow,
	controlsFor,
	sameNotice,
	viewOf,
} from "./controls";
import type { Phase } from "./rules";

const phase = (
	name: Phase,
	options: { oni?: string | null; area?: string | null } = {},
) => ({
	type: "phase",
	phase: name,
	durationMs: name === "oni-selection" ? null : 20_000,
	oni: options.oni ?? null,
	outcome: name === "reveal" || name === "ended" ? "hiders-win" : null,
	area: name === "oni-selection" ? (options.area ?? "ready") : null,
});
const stage = { type: "stage", width: 1, depth: 1 };
const doors = { type: "doors", openDoors: [] };
const members = { type: "members", members: [] };
const roomInfo = { type: "room-info", explorationSeconds: 60 };
const hiding = (ids: string[]) => ({ type: "hiding", playerIds: ids });

const context = (
	overrides: Partial<ControlsContext> = {},
): ControlsContext => ({
	you: "b",
	posable: true,
	paintSubmitted: false,
	nearDoor: false,
	...overrides,
});

describe("viewOf・applyNotice - 届いた通知の並びを、画面の購読と同じ読み方で畳む", () => {
	it("途中参加の通知の並び（ステージ・襖・フェーズ・メンバー・ルーム情報）から、フェーズとエリアを読む", () => {
		const view = viewOf([
			stage,
			doors,
			phase("oni-selection"),
			members,
			roomInfo,
		]);
		expect(view.notice?.phase).toBe("oni-selection");
		expect(view.notice?.area).toBe("ready");
		expect(view.hiding).toBeNull();
	});

	it("形の違う通知と、知らない通知は、読み飛ばす", () => {
		const view = viewOf([
			{ type: "phase", phase: "nope" },
			{ type: "x" },
			null,
		]);
		expect(view).toEqual(NO_NOTICES);
	});

	it("同じ中身のフェーズの通知（復帰の送り直し）は、前の通知をそのまま保つ", () => {
		const first = applyNotice(NO_NOTICES, phase("preparation", { oni: "a" }));
		const again = applyNotice(first, phase("preparation", { oni: "a" }));
		expect(again.notice).toBe(first.notice);
		expect(again).toBe(first);
	});

	it("まだ隠れている人の通知を読む", () => {
		const view = viewOf([phase("exploration", { oni: "a" }), hiding(["c"])]);
		expect(view.hiding).toEqual(["c"]);
	});
});

describe("sameNotice - 中身が同じフェーズの通知か", () => {
	it("フェーズ・長さ・鬼・結果・エリアが全部同じなら同じ", () => {
		const a = applyNotice(NO_NOTICES, phase("oni-selection")).notice;
		const b = applyNotice(NO_NOTICES, phase("oni-selection")).notice;
		const c = applyNotice(
			NO_NOTICES,
			phase("oni-selection", { area: "counting" }),
		).notice;
		expect(sameNotice(a, b)).toBe(true);
		expect(sameNotice(a, c)).toBe(false);
		expect(sameNotice(null, a)).toBe(false);
	});
});

describe("controlsFor - 途中参加の不具合の再現（CPU ありのルームの 2 人目）", () => {
	it("フェーズの通知が届いていれば、待機ルームで移動パッドと鬼希望エリアが出る", () => {
		const view = viewOf([
			stage,
			doors,
			phase("oni-selection"),
			members,
			roomInfo,
		]);
		const controls = controlsFor(view, context());
		expect(controls).toContain("move");
		expect(controls).toContain("area");
		expect(controls).toContain("look");
		expect(controls).not.toContain("pending");
	});

	it("フェーズの通知が届いていない間は、黙って隠さず「接続中」（pending）を出す。届いたら、すぐ移動パッド", () => {
		const before = viewOf([stage, doors, members, roomInfo]);
		expect(controlsFor(before, context())).toEqual(["pending", "look"]);
		const after = applyNotice(before, phase("oni-selection"));
		expect(controlsFor(after, context())).toContain("move");
	});
});

/** 時機ごとの、ふさわしい操作部品（鬼 a、隠れ側 b・c。素材の体）。 */
type Case = readonly [
	label: string,
	payloads: readonly unknown[],
	you: string,
	expected: readonly Control[],
];
const CASES: readonly Case[] = [
	[
		"鬼選出（赤）・2 人目",
		[phase("oni-selection", { area: "waiting" })],
		"b",
		["move", "look", "area", "waiting-pose"],
	],
	[
		"鬼選出（緑）・2 人目",
		[phase("oni-selection")],
		"b",
		["move", "look", "area", "waiting-pose"],
	],
	[
		"鬼選出（カウント中）・3 人目",
		[phase("oni-selection", { area: "counting" })],
		"c",
		["move", "look", "area", "waiting-pose"],
	],
	[
		"準備移動・隠れ側",
		[phase("preparation", { oni: "a" })],
		"b",
		["move", "look", "game-pose"],
	],
	[
		"準備移動・鬼",
		[phase("preparation", { oni: "a" })],
		"a",
		["move", "look", "waiting-paint"],
	],
	[
		"ペイント・隠れ側",
		[phase("painting", { oni: "a" })],
		"b",
		["look", "paint"],
	],
	[
		"ペイント・鬼",
		[phase("painting", { oni: "a" })],
		"a",
		["move", "look", "waiting-paint"],
	],
	[
		"探索・鬼",
		[phase("exploration", { oni: "a" }), hiding(["b", "c"])],
		"a",
		["move", "look", "shoot"],
	],
	[
		"探索・隠れている隠れ側",
		[phase("exploration", { oni: "a" }), hiding(["b", "c"])],
		"b",
		["look"],
	],
	[
		"探索・見つかった隠れ側（観戦）",
		[phase("exploration", { oni: "a" }), hiding(["c"])],
		"b",
		["look"],
	],
	["答え合わせ・鬼", [phase("reveal", { oni: "a" })], "a", ["look"]],
	["答え合わせ・隠れ側", [phase("reveal", { oni: "a" })], "b", ["look"]],
	["終了", [phase("ended", { oni: "a" })], "b", ["look"]],
	[
		"鬼 CPU の準備移動・人間の隠れ側",
		[phase("preparation", { oni: "cpu-1" })],
		"b",
		["move", "look", "game-pose"],
	],
	[
		"鬼 CPU の探索・人間の隠れ側",
		[phase("exploration", { oni: "cpu-1" }), hiding(["b", "cpu-2"])],
		"b",
		["look"],
	],
];

describe("controlsFor - 時機ごとの操作部品（組み合わせ）", () => {
	it.each(CASES)("%s", (_label, payloads, you, expected) => {
		expect(controlsFor(viewOf(payloads), context({ you }))).toEqual(expected);
	});
});

describe("controlsFor - ほかの操作部品の見落とし（撃つ・襖・ポーズ・塗る）", () => {
	const all: Phase[] = [
		"oni-selection",
		"preparation",
		"painting",
		"exploration",
		"reveal",
		"ended",
	];
	const at = (
		p: Phase,
		you: string,
		overrides: Partial<ControlsContext> = {},
	) =>
		controlsFor(
			viewOf([
				phase(p, { oni: p === "oni-selection" ? null : "a" }),
				hiding(["b"]),
			]),
			context({ you, ...overrides }),
		);

	it("撃つは、探索中の鬼だけ", () => {
		for (const p of all) {
			expect(at(p, "a").includes("shoot"), p).toBe(p === "exploration");
			expect(at(p, "b").includes("shoot"), p).toBe(false);
		}
	});

	it("襖を開けるは、動けて、襖のそばにいるときだけ（動けない隠れ側には出さない）", () => {
		expect(at("preparation", "b", { nearDoor: true })).toContain("open-door");
		expect(at("exploration", "a", { nearDoor: true })).toContain("open-door");
		expect(at("exploration", "b", { nearDoor: true })).not.toContain(
			"open-door",
		);
		expect(at("painting", "b", { nearDoor: true })).not.toContain("open-door");
		expect(at("preparation", "b", { nearDoor: false })).not.toContain(
			"open-door",
		);
	});

	it("ポーズは、素材の体のときだけ。待機ポーズは鬼選出、ゲームのポーズは準備移動の隠れ側（確定の前）", () => {
		expect(at("oni-selection", "b", { posable: false })).not.toContain(
			"waiting-pose",
		);
		expect(at("preparation", "b", { posable: false })).not.toContain(
			"game-pose",
		);
		expect(at("preparation", "b", { paintSubmitted: true })).not.toContain(
			"game-pose",
		);
		for (const p of all) {
			expect(at(p, "b").includes("waiting-pose"), p).toBe(
				p === "oni-selection",
			);
			expect(at(p, "b").includes("game-pose"), p).toBe(p === "preparation");
			expect(at(p, "a").includes("game-pose"), p).toBe(false);
		}
	});

	it("塗るは、ペイントフェーズの隠れ側（観戦でない）。鬼は、準備移動とペイントの間、待機ルームで色を塗り替えられる", () => {
		for (const p of all) {
			expect(at(p, "b").includes("paint"), p).toBe(p === "painting");
			expect(at(p, "a").includes("waiting-paint"), p).toBe(
				p === "preparation" || p === "painting",
			);
		}
		// 見つかった（観戦の）隠れ側には、ペイントの板を出さない。
		expect(
			controlsFor(
				viewOf([phase("painting", { oni: "a" }), hiding(["c"])]),
				context({ you: "b" }),
			),
		).not.toContain("paint");
	});

	it("移動パッドの条件は、画面の移動（canMoveNow）と同じ", () => {
		for (const p of all) {
			for (const you of ["a", "b"]) {
				const view = viewOf([
					phase(p, { oni: p === "oni-selection" ? null : "a" }),
				]);
				expect(controlsFor(view, context({ you })).includes("move")).toBe(
					canMoveNow(view, you),
				);
			}
		}
	});
});
