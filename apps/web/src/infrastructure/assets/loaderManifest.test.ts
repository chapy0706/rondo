import { describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "./loader";

/**
 * manifest.json の取得の覚え方（平屋の素材が読み込まれない件の手当て）。成功だけを覚え、失敗は
 * 覚えない。失敗のあとは一定の間隔（既定 5 秒）が過ぎるまで取り直さない。取得中の要求は共有する。
 * 1回の読み込みの中では、manifest の取得を再試行しない。
 */

const base = "https://assets.example.test";
const manifestUrl = `${base}/manifest.json`;
const cubeUrl = `${base}/v1/test/test-cube-512.glb`;
const MANIFEST = {
	version: 1,
	assets: [
		{
			key: "test-cube",
			quality: 512,
			version: 1,
			path: "v1/test/test-cube-512.glb",
			bytes: 20,
		},
	],
};

function glbBytes(): ArrayBuffer {
	const buffer = new ArrayBuffer(20);
	const view = new DataView(buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, 20, true);
	return buffer;
}

/** manifest の応答を切り替えられる配信と、差し替えられる時計。 */
function setup(options: { retryMs?: number } = {}) {
	let manifestOk = false;
	let release: (() => void) | null = null;
	let hold = false;
	let clock = 0;
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url === manifestUrl) {
			if (hold) {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			return manifestOk
				? new Response(JSON.stringify(MANIFEST))
				: new Response(null, { status: 503 });
		}
		if (url === cubeUrl) return new Response(glbBytes());
		return new Response(null, { status: 404 });
	});
	const loader = createAssetLoader({
		baseUrl: base,
		fetch,
		parse: async () => "cube",
		log: vi.fn(),
		now: () => clock,
		...(options.retryMs === undefined
			? {}
			: { manifestRetryMs: options.retryMs }),
	});
	const manifestCalls = () =>
		fetch.mock.calls.filter(([url]) => String(url) === manifestUrl).length;
	return {
		loader,
		manifestCalls,
		succeed: () => {
			manifestOk = true;
		},
		holdManifest: () => {
			hold = true;
		},
		releaseManifest: () => {
			hold = false;
			release?.();
		},
		at: (ms: number) => {
			clock = ms;
		},
	};
}

describe("getManifest - 成功だけを覚え、失敗は覚えない", () => {
	it("成功は覚える（2回目の読み込みでは取りに行かない）", async () => {
		const s = setup();
		s.succeed();
		expect((await s.loader.load("test-cube")).ok).toBe(true);
		s.at(60_000);
		expect((await s.loader.load("test-cube")).ok).toBe(true);
		expect(s.manifestCalls()).toBe(1);
	});

	it("1回の読み込みの中では、manifest の取得を再試行しない", async () => {
		const s = setup();
		expect(await s.loader.load("test-cube")).toEqual({
			ok: false,
			reason: "manifest-unavailable",
		});
		expect(s.manifestCalls()).toBe(1);
	});

	it("失敗のあと、間隔（既定 5 秒）の前は取り直さず、仮の表示のまま。後の読み込みで取り直す", async () => {
		const s = setup();
		await s.loader.load("test-cube");
		s.at(4_999);
		expect(await s.loader.load("test-cube")).toEqual({
			ok: false,
			reason: "manifest-unavailable",
		});
		expect(s.manifestCalls()).toBe(1);
		s.at(5_000);
		await s.loader.load("test-cube");
		expect(s.manifestCalls()).toBe(2);
	});

	it("間隔は差し替えられる", async () => {
		const s = setup({ retryMs: 1_000 });
		await s.loader.load("test-cube");
		s.at(999);
		await s.loader.load("test-cube");
		expect(s.manifestCalls()).toBe(1);
		s.at(1_000);
		await s.loader.load("test-cube");
		expect(s.manifestCalls()).toBe(2);
	});

	it("失敗のあとに成功したら、以後の読み込みが通る（成功を覚え、取りに行かない）", async () => {
		const s = setup();
		await s.loader.load("test-cube");
		s.succeed();
		s.at(5_000);
		expect((await s.loader.load("test-cube")).ok).toBe(true);
		s.at(20_000);
		expect((await s.loader.load("test-cube")).ok).toBe(true);
		expect(s.manifestCalls()).toBe(2);
	});
});

describe("getManifest - 取得中の要求を共有する", () => {
	it("同時の読み込みは、1回の取得を共有し、どちらも通る", async () => {
		const s = setup();
		s.succeed();
		s.holdManifest();
		const first = s.loader.load("test-cube");
		const second = s.loader.load("test-cube");
		await Promise.resolve();
		s.releaseManifest();
		expect((await first).ok).toBe(true);
		expect((await second).ok).toBe(true);
		expect(s.manifestCalls()).toBe(1);
	});

	it("共有した取得が失敗したら、どちらも仮の表示になり、取得は1回だけ", async () => {
		const s = setup();
		s.holdManifest();
		const first = s.loader.load("test-cube");
		const second = s.loader.load("test-cube");
		await Promise.resolve();
		s.releaseManifest();
		expect(await first).toEqual({ ok: false, reason: "manifest-unavailable" });
		expect(await second).toEqual({
			ok: false,
			reason: "manifest-unavailable",
		});
		expect(s.manifestCalls()).toBe(1);
	});
});
