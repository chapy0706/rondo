import { afterEach, describe, expect, it, vi } from "vitest";
import { type AssetLoaderOptions, createAssetLoader } from "./loader";
import { createSwapSlot } from "./slot";

/** 正しい glb の先頭（magic "glTF"、版 2、全体の長さ）を持つ、最小のバイト列。 */
function glbBytes(): ArrayBuffer {
	const buffer = new ArrayBuffer(20);
	const view = new DataView(buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, 20, true);
	return buffer;
}

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
		{
			key: "test-cube",
			quality: 1024,
			version: 1,
			path: "v1/test/test-cube-1024.glb",
			bytes: 20,
		},
	],
};

function response(status: number, body: BodyInit | null): Response {
	return new Response(body, { status });
}

/** URL ごとの応答を決めた fetch。 */
function fakeFetch(routes: Record<string, () => Promise<Response>>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const route = routes[url];
		if (!route) return response(404, null);
		// 中止の合図が来たら、AbortError で終わる（本物の fetch と同じ）。
		return await new Promise<Response>((resolve, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(new DOMException("aborted", "AbortError")),
			);
			route().then(resolve, reject);
		});
	});
}

function setup(
	routes: Record<string, () => Promise<Response>>,
	overrides: Partial<AssetLoaderOptions> = {},
) {
	const log = vi.fn();
	const parse = vi.fn(async (data: ArrayBuffer) => ({
		parsed: data.byteLength,
	}));
	const loader = createAssetLoader({
		baseUrl: "https://assets.example.test",
		fetch: fakeFetch(routes),
		parse,
		log,
		timeoutMs: 1000,
		...overrides,
	});
	return { loader, log, parse };
}

const manifestUrl = "https://assets.example.test/manifest.json";
const cubeUrl = "https://assets.example.test/v1/test/test-cube-512.glb";

afterEach(() => {
	vi.useRealTimers();
});

describe("createAssetLoader - 素材の読み込みとフォールバック", () => {
	it("成功: manifest から品質 512 のパスを引き、glb を読み込む", async () => {
		const { loader, log, parse } = setup({
			[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
			[cubeUrl]: async () => response(200, glbBytes()),
		});
		const result = await loader.load("test-cube");
		expect(result).toEqual({ ok: true, value: { parsed: 20 } });
		expect(parse).toHaveBeenCalledTimes(1);
		expect(log).not.toHaveBeenCalled();
	});

	it("基準 URL が未設定: 何も取りに行かず、仮の表示にする", async () => {
		const fetch = vi.fn();
		const log = vi.fn();
		const loader = createAssetLoader({
			baseUrl: undefined,
			fetch,
			parse: vi.fn(),
			log,
		});
		const result = await loader.load("test-cube");
		expect(result).toEqual({ ok: false, reason: "disabled" });
		expect(fetch).not.toHaveBeenCalled();
		// 未設定は想定内の状態なので、毎回は記録しない（1回だけ）。
		await loader.load("test-cube");
		expect(log).toHaveBeenCalledTimes(1);
	});

	it("manifest が無い（404）: 仮の表示にし、原因を記録する", async () => {
		const { loader, log } = setup({});
		const result = await loader.load("test-cube");
		expect(result).toEqual({ ok: false, reason: "manifest-unavailable" });
		expect(log).toHaveBeenCalledWith(expect.stringContaining("manifest"));
	});

	it("manifest の形が違う: 仮の表示にする", async () => {
		const { loader } = setup({
			[manifestUrl]: async () => response(200, JSON.stringify({ assets: "x" })),
		});
		expect(await loader.load("test-cube")).toEqual({
			ok: false,
			reason: "manifest-unavailable",
		});
	});

	it("manifest に無い素材: 仮の表示にする", async () => {
		const { loader } = setup({
			[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
		});
		expect(await loader.load("hiraya-indoor")).toEqual({
			ok: false,
			reason: "not-in-manifest",
		});
	});

	it("glb が 404: 仮の表示にし、原因を記録する", async () => {
		const { loader, log } = setup({
			[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
		});
		expect(await loader.load("test-cube")).toEqual({
			ok: false,
			reason: "http-error",
		});
		expect(log).toHaveBeenCalledWith(expect.stringContaining("404"));
	});

	it("壊れた glb（先頭が glTF でない）: 読み込まずに仮の表示にする", async () => {
		const { loader, parse } = setup({
			[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
			[cubeUrl]: async () =>
				response(200, new TextEncoder().encode("not a glb file")),
		});
		expect(await loader.load("test-cube")).toEqual({
			ok: false,
			reason: "invalid-glb",
		});
		expect(parse).not.toHaveBeenCalled();
	});

	it("壊れた glb（読み込みで失敗）: 仮の表示にする", async () => {
		const { loader } = setup(
			{
				[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
				[cubeUrl]: async () => response(200, glbBytes()),
			},
			{
				parse: async () => {
					throw new Error("bad gltf");
				},
			},
		);
		expect(await loader.load("test-cube")).toEqual({
			ok: false,
			reason: "invalid-glb",
		});
	});

	it("タイムアウト: 待ちすぎたら中止して、仮の表示にする", async () => {
		vi.useFakeTimers();
		const { loader, log } = setup(
			{
				[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
				// 応答が返ってこない。
				[cubeUrl]: () => new Promise<Response>(() => {}),
			},
			{ timeoutMs: 1000 },
		);
		const pending = loader.load("test-cube");
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({ ok: false, reason: "timeout" });
		expect(log).toHaveBeenCalledWith(expect.stringContaining("timeout"));
	});

	it("接続できない（fetch が失敗）: 仮の表示にする", async () => {
		const { loader } = setup(
			{},
			{
				fetch: async () => {
					throw new TypeError("Failed to fetch");
				},
			},
		);
		expect(await loader.load("test-cube")).toEqual({
			ok: false,
			reason: "manifest-unavailable",
		});
	});

	it("manifest は1回だけ取りに行く", async () => {
		const fetch = fakeFetch({
			[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
			[cubeUrl]: async () => response(200, glbBytes()),
		});
		const loader = createAssetLoader({
			baseUrl: "https://assets.example.test/",
			fetch,
			parse: async () => "ok",
			log: vi.fn(),
		});
		await loader.load("test-cube");
		await loader.load("test-cube");
		const manifestCalls = fetch.mock.calls.filter(([url]) =>
			String(url).endsWith("/manifest.json"),
		);
		expect(manifestCalls).toHaveLength(1);
	});

	it("品質 1024 を指定できる（既定は 512）", async () => {
		const url1024 = "https://assets.example.test/v1/test/test-cube-1024.glb";
		const { loader } = setup(
			{
				[manifestUrl]: async () => response(200, JSON.stringify(MANIFEST)),
				[url1024]: async () => response(200, glbBytes()),
			},
			{ quality: 1024 },
		);
		expect((await loader.load("test-cube")).ok).toBe(true);
	});
});

describe("createSwapSlot - 仮の表示との差し替えのタイミング", () => {
	it("読み込めていれば、差し替えの時点で本素材を渡す", async () => {
		const slot = createSwapSlot(
			Promise.resolve({ ok: true, value: "real" } as const),
		);
		await Promise.resolve();
		expect(slot.take()).toBe("real");
	});

	it("間に合わなければ、その回は仮の表示のまま（後で読み込めても差し替えない）", async () => {
		let resolve: (v: { ok: true; value: string }) => void = () => {};
		const slot = createSwapSlot(
			new Promise<{ ok: true; value: string }>((r) => {
				resolve = r;
			}),
		);
		expect(slot.take()).toBeNull();
		slot.lock();
		resolve({ ok: true, value: "late" });
		await Promise.resolve();
		expect(slot.take()).toBeNull();
	});

	it("読み込みに失敗していれば、仮の表示のまま", async () => {
		const slot = createSwapSlot(
			Promise.resolve({ ok: false, reason: "http-error" } as const),
		);
		await Promise.resolve();
		expect(slot.take()).toBeNull();
	});
});
