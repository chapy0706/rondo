import { describe, expect, it, vi } from "vitest";
import type { LoadResult } from "../../infrastructure/assets";
import {
	HIRAYA_KEYS,
	combineHiraya,
	createVeryareAssets,
	prefetchLobbyAssets,
} from "./assetSlots";

const ok = <T>(value: T): LoadResult<T> => ({ ok: true, value });
const failed = { ok: false, reason: "http-error" } as const;

/** 約束した結果を、マイクロタスクが回るまで待つ。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const keysOf = (preload: { mock: { calls: unknown[][] } }) =>
	preload.mock.calls.map(([key]) => key);

describe("combineHiraya - 平屋の3つの glb を1つにまとめる（issue-46）", () => {
	it("屋内本体が読めれば使う。屋外の飾りと屋根は、読めたものだけ使う", () => {
		expect(combineHiraya(ok("in"), ok("out"), ok("roof"))).toEqual(
			ok({ indoor: "in", outdoor: "out", roof: "roof" }),
		);
		expect(combineHiraya(ok("in"), failed, failed)).toEqual(
			ok({ indoor: "in", outdoor: null, roof: null }),
		);
	});

	it("屋内本体が読めなければ、全体を仮の表示にする（屋内本体の失敗の理由のまま）", () => {
		expect(combineHiraya(failed, ok("out"), ok("roof"))).toEqual(failed);
	});
});

describe("createVeryareAssets - veryare の素材の入口（issue-46）", () => {
	it("差し替え口を作ると、平屋の3つの key の読み込みを始める", () => {
		const preload = vi.fn(async (key: string) => ok(key));
		createVeryareAssets(preload).hirayaSlot();
		expect(keysOf(preload)).toEqual([
			HIRAYA_KEYS.indoor,
			HIRAYA_KEYS.outdoor,
			HIRAYA_KEYS.roof,
		]);
	});

	it("先読み（ロビー）は1回だけ。最初の差し替え口は、先読みの結果を使い、取りに行き直さない", async () => {
		const preload = vi.fn(async (key: string) => ok(key));
		const assets = createVeryareAssets(preload);
		assets.prefetchHiraya();
		assets.prefetchHiraya();
		expect(preload).toHaveBeenCalledTimes(3);
		const slot = assets.hirayaSlot();
		expect(preload).toHaveBeenCalledTimes(3);
		await settle();
		expect(slot.take()).toEqual({
			indoor: HIRAYA_KEYS.indoor,
			outdoor: HIRAYA_KEYS.outdoor,
			roof: HIRAYA_KEYS.roof,
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
		expect(preload).toHaveBeenCalledTimes(6);
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
		expect(preload).toHaveBeenCalledTimes(3);
	});
});

describe("素材の流れの記録（開発中だけ Console に出す / assetTrace.ts）", () => {
	it("先読みの結果を使ったか、manifest と3本の結果を記録する", async () => {
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
