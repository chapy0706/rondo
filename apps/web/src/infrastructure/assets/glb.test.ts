import { describe, expect, it, vi } from "vitest";
import { createGlbParse, usesMeshopt } from "./glb";
import { DecoderUnavailable, createAssetLoader } from "./loader";

/** JSON チャンクだけを持つ glb（magic・版 2・長さ、JSON チャンクは 4 バイト境界に空白で詰める）。 */
function glbWith(json: unknown): ArrayBuffer {
	let text = JSON.stringify(json);
	while (text.length % 4 !== 0) text += " ";
	const body = new TextEncoder().encode(text);
	const buffer = new ArrayBuffer(12 + 8 + body.byteLength);
	const view = new DataView(buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, buffer.byteLength, true);
	view.setUint32(12, body.byteLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	new Uint8Array(buffer, 20).set(body);
	return buffer;
}

const compressed = () =>
	glbWith({
		asset: { version: "2.0" },
		extensionsUsed: ["EXT_meshopt_compression", "KHR_mesh_quantization"],
		extensionsRequired: ["EXT_meshopt_compression", "KHR_mesh_quantization"],
	});
const plain = () => glbWith({ asset: { version: "2.0" } });

describe("usesMeshopt - glb が meshopt の圧縮を使うか（issue-55）", () => {
	it("extensionsUsed に EXT_meshopt_compression があれば true", () => {
		expect(usesMeshopt(compressed())).toBe(true);
	});

	it("無ければ false。JSON チャンクが読めないときも false（読み込みは GLTFLoader に任せる）", () => {
		expect(usesMeshopt(plain())).toBe(false);
		expect(usesMeshopt(new ArrayBuffer(20))).toBe(false);
		const broken = compressed();
		new DataView(broken).setUint32(16, 0, true);
		expect(usesMeshopt(broken)).toBe(false);
	});
});

describe("createGlbParse - デコーダの読み込み（issue-55）", () => {
	const decoder = { ready: Promise.resolve() };

	it("圧縮していない glb では、デコーダを読み込まずに読む", async () => {
		const loadDecoder = vi.fn(async () => decoder);
		const parseGltf = vi.fn(async () => "scene");
		const parse = createGlbParse({ loadDecoder, parseGltf });
		await expect(parse(plain())).resolves.toBe("scene");
		expect(loadDecoder).not.toHaveBeenCalled();
		expect(parseGltf).toHaveBeenCalledWith(expect.any(ArrayBuffer), null);
	});

	it("meshopt の glb では、デコーダを1回だけ読み込み、GLTFLoader に渡す", async () => {
		const loadDecoder = vi.fn(async () => decoder);
		const parseGltf = vi.fn(async () => "scene");
		const parse = createGlbParse({ loadDecoder, parseGltf });
		await parse(compressed());
		await parse(compressed());
		expect(loadDecoder).toHaveBeenCalledTimes(1);
		expect(parseGltf).toHaveBeenLastCalledWith(
			expect.any(ArrayBuffer),
			decoder,
		);
	});

	it("デコーダの読み込みに失敗したら、DecoderUnavailable で失敗する（GLTFLoader は呼ばない）", async () => {
		const parseGltf = vi.fn(async () => "scene");
		const parse = createGlbParse({
			loadDecoder: async () => {
				throw new Error("wasm を読み込めない");
			},
			parseGltf,
		});
		await expect(parse(compressed())).rejects.toBeInstanceOf(
			DecoderUnavailable,
		);
		expect(parseGltf).not.toHaveBeenCalled();
	});

	it("デコーダの準備（ready）が失敗しても、DecoderUnavailable で失敗する", async () => {
		const parse = createGlbParse({
			loadDecoder: async () => ({
				ready: Promise.reject(new Error("WebAssembly が使えない")),
			}),
			parseGltf: async () => "scene",
		});
		await expect(parse(compressed())).rejects.toBeInstanceOf(
			DecoderUnavailable,
		);
	});
});

describe("デコーダが読めないとき、素材のローダーは仮の表示に切り替える（issue-55）", () => {
	const base = "https://assets.example.test";
	const manifest = {
		version: 1,
		assets: [
			{
				key: "hiraya-indoor",
				quality: 512,
				version: 2,
				path: "v2/house/hiraya-indoor-512.glb",
				bytes: 0,
			},
			{
				key: "test-cube",
				quality: 512,
				version: 1,
				path: "v1/test/test-cube-512.glb",
				bytes: 0,
			},
		],
	};

	function setup() {
		const log = vi.fn();
		const parseGltf = vi.fn(async () => "scene");
		const loader = createAssetLoader({
			baseUrl: base,
			fetch: async (input) => {
				const url = String(input);
				if (url === `${base}/manifest.json`) {
					return new Response(JSON.stringify(manifest));
				}
				if (url.endsWith("hiraya-indoor-512.glb")) {
					return new Response(compressed());
				}
				if (url.endsWith("test-cube-512.glb")) return new Response(plain());
				return new Response(null, { status: 404 });
			},
			parse: createGlbParse({
				loadDecoder: async () => {
					throw new Error("チャンクを読み込めない");
				},
				parseGltf,
			}),
			log,
			timeoutMs: 1000,
		});
		return { loader, log, parseGltf };
	}

	it("meshopt の素材は decoder-unavailable で仮の表示になり、原因を記録する（例外は投げない）", async () => {
		const { loader, log } = setup();
		await expect(loader.load("hiraya-indoor")).resolves.toEqual({
			ok: false,
			reason: "decoder-unavailable",
		});
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("[assets] decoder-unavailable"),
		);
	});

	it("圧縮していない素材は、デコーダが読めなくても読み込める", async () => {
		const { loader } = setup();
		await expect(loader.load("test-cube")).resolves.toEqual({
			ok: true,
			value: "scene",
		});
	});
});
