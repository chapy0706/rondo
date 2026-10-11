import { describe, expect, it, vi } from "vitest";

const prefetch = vi.fn();
vi.mock("./veryare/prefetch", () => ({ prefetchForLobby: prefetch }));

const { prefetchForLobby } = await import("./registry");

/** 遅延読み込み（動的 import）が終わるまで待つ。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("prefetchForLobby - ロビーを開いた時点の先読みの振り分け（issue-46）", () => {
	it("veryare のロビーでは、veryare の先読みを呼ぶ", async () => {
		prefetch.mockClear();
		prefetchForLobby("veryare");
		await settle();
		expect(prefetch).toHaveBeenCalledTimes(1);
	});

	it("登録の無いゲームでは、何もしない（例外も出さない）", async () => {
		prefetch.mockClear();
		expect(() => prefetchForLobby("tetris")).not.toThrow();
		expect(() => prefetchForLobby("unknown")).not.toThrow();
		await settle();
		expect(prefetch).not.toHaveBeenCalled();
	});
});
