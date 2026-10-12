import { describe, expect, it, vi } from "vitest";
import type { LoadResult } from "../../infrastructure/assets";
import {
	CHARACTER_KEYS,
	HIRAYA_KEYS,
	STAGE_MATERIALS_KEY,
	combineCharacter,
	combineHiraya,
	createVeryareAssets,
	prefetchLobbyAssets,
	takeOnce,
} from "./assetSlots";

const ok = <T>(value: T): LoadResult<T> => ({ ok: true, value });
const failed = { ok: false, reason: "http-error" } as const;

/** 約束した結果を、マイクロタスクが回るまで待つ。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const keysOf = (preload: { mock: { calls: unknown[][] } }) =>
	preload.mock.calls.map(([key]) => key);

describe("combineHiraya - 平屋の4つの glb を1つにまとめる（issue-46）", () => {
	it("屋内本体が読めれば使う。屋外の飾り・屋根・家具の箱は、読めたものだけ使う", () => {
		expect(
			combineHiraya(ok("in"), ok("out"), ok("roof"), ok("furniture")),
		).toEqual(
			ok({
				indoor: "in",
				outdoor: "out",
				roof: "roof",
				furniture: "furniture",
			}),
		);
		expect(combineHiraya(ok("in"), failed, failed, failed)).toEqual(
			ok({ indoor: "in", outdoor: null, roof: null, furniture: null }),
		);
	});

	it("屋内本体が読めなければ、全体を仮の表示にする（屋内本体の失敗の理由のまま。家具の箱も使わない）", () => {
		expect(
			combineHiraya(failed, ok("out"), ok("roof"), ok("furniture")),
		).toEqual(failed);
	});
});

describe("createVeryareAssets - veryare の素材の入口（issue-46）", () => {
	it("差し替え口を作ると、平屋の4つの key の読み込みを始める", () => {
		const preload = vi.fn(async (key: string) => ok(key));
		createVeryareAssets(preload).hirayaSlot();
		expect(keysOf(preload)).toEqual([
			HIRAYA_KEYS.indoor,
			HIRAYA_KEYS.outdoor,
			HIRAYA_KEYS.roof,
			HIRAYA_KEYS.furniture,
		]);
		expect(HIRAYA_KEYS.furniture).toBe("hiraya-furniture");
	});

	it("先読み（ロビー）は1回だけ。最初の差し替え口は、先読みの結果を使い、取りに行き直さない", async () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const assets = createVeryareAssets(preload);
		assets.prefetchHiraya();
		assets.prefetchHiraya();
		expect(preload).toHaveBeenCalledTimes(4);
		const slot = assets.hirayaSlot();
		expect(preload).toHaveBeenCalledTimes(4);
		await settle();
		expect(slot.take()).toEqual({
			indoor: HIRAYA_KEYS.indoor,
			outdoor: HIRAYA_KEYS.outdoor,
			roof: HIRAYA_KEYS.roof,
			furniture: HIRAYA_KEYS.furniture,
		});
	});

	it("2回目以降の対戦の差し替え口は、新しく読み直す（前の対戦の lock を引き継がない）", async () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const assets = createVeryareAssets(preload);
		const first = assets.hirayaSlot();
		await settle();
		first.lock();
		expect(first.take()).toBeNull();
		const second = assets.hirayaSlot();
		expect(second).not.toBe(first);
		expect(preload).toHaveBeenCalledTimes(8);
		await settle();
		expect(second.take()).not.toBeNull();
	});

	it("屋内本体が読めなければ、ずっと取り出せない（箱の表示のまま）", async () => {
		const assets = createVeryareAssets(async (key: string) =>
			key === HIRAYA_KEYS.indoor ? failed : ok(key),
		);
		const slot = assets.hirayaSlot();
		await settle();
		expect(slot.take()).toBeNull();
	});

	it("読み込みを始める前は、何も取りに行かない（平屋でないルームでは読まない）", () => {
		const preload = vi.fn(async (key: string) => ok(key));
		createVeryareAssets(preload);
		expect(preload).not.toHaveBeenCalled();
	});
});

describe("prefetchLobbyAssets - ロビーを開いた時点の先読み（issue-46）", () => {
	it("平屋の選択肢を出すときだけ、先読みを始める", () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const assets = createVeryareAssets(preload);
		prefetchLobbyAssets(false, assets);
		expect(preload).not.toHaveBeenCalled();
		prefetchLobbyAssets(true, assets);
		prefetchLobbyAssets(true, assets);
		expect(preload).toHaveBeenCalledTimes(4);
	});
});

describe("素材の流れの記録（開発中だけ Console に出す / assetTrace.ts）", () => {
	it("先読みの結果を使ったか、manifest と4本の結果を記録する", async () => {
		const trace = vi.fn();
		const assets = createVeryareAssets(
			async (key: string) => (key === HIRAYA_KEYS.roof ? failed : ok(key)),
			trace,
		);
		assets.prefetchHiraya();
		assets.hirayaSlot();
		assets.hirayaSlot();
		await settle();
		const events = trace.mock.calls.map(([event]) => event);
		expect(events.filter((e) => e.kind === "slot")).toEqual([
			{ kind: "slot", from: "prefetch" },
			{ kind: "slot", from: "new" },
		]);
		expect(events).toContainEqual({ kind: "manifest", status: "ok" });
		expect(events).toContainEqual({
			kind: "load",
			key: HIRAYA_KEYS.indoor,
			ok: true,
		});
		expect(events).toContainEqual({
			kind: "load",
			key: HIRAYA_KEYS.roof,
			ok: false,
			reason: "http-error",
		});
	});
});

describe("characterSlot - キャラクターの素材（issue-56 / issue-57）", () => {
	it("差し替え口を作ると、体・ポーズの表・動きの3つの key の読み込みを始める", async () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const slot = createVeryareAssets(preload).characterSlot();
		expect(keysOf(preload)).toEqual([
			CHARACTER_KEYS.body,
			CHARACTER_KEYS.poses,
			CHARACTER_KEYS.motions,
		]);
		expect(CHARACTER_KEYS).toEqual({
			body: "character-body",
			poses: "character-poses",
			motions: "character-motions",
		});
		await settle();
		expect(slot.take()).toEqual({
			body: CHARACTER_KEYS.body,
			poses: CHARACTER_KEYS.poses,
			motions: CHARACTER_KEYS.motions,
		});
	});

	it("体かポーズの表のどちらかが読めなければ、取り出せない（仮のカプセルのまま）", async () => {
		for (const missing of [CHARACTER_KEYS.body, CHARACTER_KEYS.poses]) {
			const slot = createVeryareAssets(async (key: string) =>
				key === missing ? failed : ok(key),
			).characterSlot();
			await settle();
			expect(slot.take()).toBeNull();
		}
	});

	it("動きの素材だけが読めなければ、体とポーズの表は使い、動きは null（体は静止のまま / issue-57）", async () => {
		const slot = createVeryareAssets(async (key: string) =>
			key === CHARACTER_KEYS.motions ? failed : ok(key),
		).characterSlot();
		await settle();
		expect(slot.take()).toEqual({
			body: CHARACTER_KEYS.body,
			poses: CHARACTER_KEYS.poses,
			motions: null,
		});
	});

	it("combineCharacter: 体とポーズの表が両方読めたときだけ、まとめる。動きは読めたときだけ使う", () => {
		expect(combineCharacter(ok("b"), ok("p"), ok("m"))).toEqual(
			ok({ body: "b", poses: "p", motions: "m" }),
		);
		expect(combineCharacter(ok("b"), ok("p"), failed)).toEqual(
			ok({ body: "b", poses: "p", motions: null }),
		);
		expect(combineCharacter(failed, ok("p"), ok("m"))).toEqual(failed);
		expect(combineCharacter(ok("b"), failed, ok("m"))).toEqual(failed);
	});
});

describe("takeOnce - 差し替え口から、1回だけ受け取る（毎コマの作り直しを防ぐ / issue-57 の不具合）", () => {
	it("読めたら1回だけ返し、その後は null（差し替え口が返し続けても）", async () => {
		const slot = createVeryareAssets(async (key: string) =>
			ok(key),
		).characterSlot();
		const take = takeOnce(slot);
		expect(take()).toBeNull();
		await settle();
		expect(take()).not.toBeNull();
		expect(take()).toBeNull();
		expect(take()).toBeNull();
		// 元の差し替え口は、lock されるまで返し続ける作り（平屋と同じ）。
		expect(slot.take()).not.toBeNull();
	});

	it("差し替え口が無ければ、いつも null", () => {
		expect(takeOnce(undefined)()).toBeNull();
	});
});

describe("stageMaterialSlot - ランダム間取りの材質の素材（stage-materials）", () => {
	it("差し替え口を作ると、stage-materials の key だけを読む。読めたら取り出せる（貼る）", async () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const slot = createVeryareAssets(preload).stageMaterialSlot();
		expect(keysOf(preload)).toEqual([STAGE_MATERIALS_KEY]);
		expect(STAGE_MATERIALS_KEY).toBe("stage-materials");
		await settle();
		expect(slot.take()).toBe(STAGE_MATERIALS_KEY);
	});

	it("読めなければ、取り出せない（色の箱のまま）。読み込みの結果を記録する", async () => {
		const trace = vi.fn();
		const slot = createVeryareAssets(
			async () => failed,
			trace,
		).stageMaterialSlot();
		await settle();
		expect(slot.take()).toBeNull();
		expect(trace).toHaveBeenCalledWith({
			kind: "load",
			key: STAGE_MATERIALS_KEY,
			ok: false,
			reason: "http-error",
		});
	});

	it("lock のあとは、読み終わっても差し替えない。takeOnce で1回だけ受け取る", async () => {
		const late = createVeryareAssets(async (key: string) =>
			ok(key),
		).stageMaterialSlot();
		late.lock();
		await settle();
		expect(late.take()).toBeNull();
		const slot = createVeryareAssets(async (key: string) =>
			ok(key),
		).stageMaterialSlot();
		const take = takeOnce(slot);
		await settle();
		expect(take()).toBe(STAGE_MATERIALS_KEY);
		expect(take()).toBeNull();
	});

	it("差し替え口を作るまでは、何も読まない（平屋のルームでは読まない）", () => {
		const preload = vi.fn(async (key: string) => ok(key));
		createVeryareAssets(preload).hirayaSlot();
		expect(keysOf(preload)).not.toContain(STAGE_MATERIALS_KEY);
	});
});
