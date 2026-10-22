import { describe, expect, it, vi } from "vitest";
import { audioLoaderOptions, findAudio, looksLikeAudio } from "./audio";
import { createAssetLoader } from "./loader";
import { parseManifest } from "./manifest";

/** 音の素材（issue-63）: manifest の audio 欄と、ローダーの広げ方（glb 以外のファイル）。 */

const base = "https://assets.example.test";
const manifestUrl = `${base}/manifest.json`;

const AUDIO_ENTRY = {
	key: "se-hit",
	kind: "se",
	version: 1,
	path: "v1/audio/se-hit.mp3",
	bytes: 4,
	durationMs: 1273,
	gain: 0.8,
};

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
	audio: [
		AUDIO_ENTRY,
		{
			key: "bgm-top",
			kind: "bgm",
			version: 1,
			path: "v1/audio/bgm-top.mp3",
			bytes: 4,
			durationMs: 64441,
			gain: 0.69,
			loop: { startMs: 20, endMs: 61940, crossfadeMs: 1000 },
		},
	],
};

function mp3Bytes(): ArrayBuffer {
	return new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer;
}

function glbBytes(): ArrayBuffer {
	const buffer = new ArrayBuffer(20);
	const view = new DataView(buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, 20, true);
	return buffer;
}

describe("manifest の audio 欄", () => {
	it("欄が無い manifest（いまの本番）も、これまでどおり読める。音の素材は無い", () => {
		const manifest = parseManifest({ version: 1, assets: MANIFEST.assets });
		expect(manifest).not.toBeNull();
		expect(manifest === null ? null : findAudio(manifest, "se-hit")).toBeNull();
	});

	it("key で引ける。種類・長さ・倍率・繰り返しを持つ", () => {
		const manifest = parseManifest(MANIFEST);
		expect(manifest).not.toBeNull();
		if (manifest === null) return;
		expect(findAudio(manifest, "se-hit")).toEqual(AUDIO_ENTRY);
		expect(findAudio(manifest, "bgm-top")?.loop).toEqual({
			startMs: 20,
			endMs: 61940,
			crossfadeMs: 1000,
		});
		expect(findAudio(manifest, "se-miss")).toBeNull();
	});

	it("形の違う audio 欄は、glb の素材を巻き込まない（その項目だけを捨てる）", () => {
		const manifest = parseManifest({
			...MANIFEST,
			audio: [
				{ ...AUDIO_ENTRY, path: "/etc/passwd" },
				{ ...AUDIO_ENTRY, key: "se-miss", gain: -1 },
				{
					...AUDIO_ENTRY,
					key: "se-count",
					loop: { startMs: 10, endMs: 5, crossfadeMs: 0 },
				},
				{ ...AUDIO_ENTRY, key: "se-start", path: "v1/../x.mp3" },
			],
		});
		expect(manifest?.assets).toHaveLength(1);
		if (manifest === null) return;
		for (const key of ["se-hit", "se-miss", "se-count", "se-start"]) {
			expect(findAudio(manifest, key)).toBeNull();
		}
		const odd = parseManifest({ ...MANIFEST, audio: "x" });
		expect(odd).not.toBeNull();
		expect(odd === null ? null : findAudio(odd, "se-hit")).toBeNull();
	});
});

describe("音のファイルの先頭", () => {
	it("ID3 の札、MP3 のフレームの頭、mp4（ftyp）を受け付ける", () => {
		expect(looksLikeAudio(mp3Bytes())).toBe(true);
		expect(
			looksLikeAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer),
		).toBe(true);
		expect(
			looksLikeAudio(
				new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]).buffer,
			),
		).toBe(true);
	});

	it("glb・テキスト・短すぎるものは受け付けない", () => {
		expect(looksLikeAudio(glbBytes())).toBe(false);
		expect(looksLikeAudio(new TextEncoder().encode("<html>").buffer)).toBe(
			false,
		);
		expect(looksLikeAudio(new ArrayBuffer(2))).toBe(false);
	});
});

describe("ローダーを glb 以外に広げる（verify を外から渡す）", () => {
	function setup(routes: Record<string, () => Response>) {
		const fetch = vi.fn(async (input: string) => {
			const route = routes[input];
			return route === undefined
				? new Response(null, { status: 404 })
				: route();
		});
		const log = vi.fn();
		const glb = createAssetLoader({
			baseUrl: base,
			fetch,
			parse: async () => "cube",
			log,
		});
		const audio = createAssetLoader<ArrayBuffer>({
			baseUrl: base,
			fetch,
			log,
			...audioLoaderOptions(glb),
		});
		return { glb, audio, fetch, log };
	}

	it("音の素材を、manifest の audio 欄のパスから取り、バイト列のまま返す", async () => {
		const s = setup({
			[manifestUrl]: () => new Response(JSON.stringify(MANIFEST)),
			[`${base}/v1/audio/se-hit.mp3`]: () => new Response(mp3Bytes()),
		});
		const result = await s.audio.load("se-hit");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.byteLength).toBe(4);
	});

	it("manifest は、glb のローダーと 1 回の取得を分け合う（要求を増やさない）", async () => {
		const s = setup({
			[manifestUrl]: () => new Response(JSON.stringify(MANIFEST)),
			[`${base}/v1/test/test-cube-512.glb`]: () => new Response(glbBytes()),
			[`${base}/v1/audio/se-hit.mp3`]: () => new Response(mp3Bytes()),
		});
		await s.glb.load("test-cube");
		await s.audio.load("se-hit");
		const urls = s.fetch.mock.calls.map(([url]) => url);
		expect(urls.filter((url) => url === manifestUrl)).toHaveLength(1);
	});

	it("audio 欄に無い key は、取りに行かない", async () => {
		const s = setup({
			[manifestUrl]: () =>
				new Response(JSON.stringify({ version: 1, assets: MANIFEST.assets })),
		});
		expect(await s.audio.load("se-hit")).toEqual({
			ok: false,
			reason: "not-in-manifest",
		});
		expect(s.fetch.mock.calls.map(([url]) => url)).toEqual([manifestUrl]);
	});

	it("音のファイルでないもの（先頭が違う）は invalid-audio", async () => {
		const s = setup({
			[manifestUrl]: () => new Response(JSON.stringify(MANIFEST)),
			[`${base}/v1/audio/se-hit.mp3`]: () => new Response("<html>404</html>"),
		});
		expect(await s.audio.load("se-hit")).toEqual({
			ok: false,
			reason: "invalid-audio",
		});
		expect(s.log.mock.calls.flat().join("\n")).toContain(
			"[assets] invalid-audio",
		);
	});

	it("基準 URL が無ければ、manifest を含めて何も取りに行かない", async () => {
		const fetch = vi.fn();
		const glb = createAssetLoader({
			baseUrl: undefined,
			fetch,
			parse: async () => "cube",
			log: vi.fn(),
		});
		expect(await glb.manifest()).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});
