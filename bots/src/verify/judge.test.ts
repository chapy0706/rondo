import { describe, expect, it } from "vitest";
import {
	judgeGlb,
	judgeManifest,
	judgeWeb,
	readEnvValues,
	smallestAssetPath,
} from "./judge.ts";

describe("judgeWeb（issue-50）", () => {
	const html = "<html><head><title>rondo</title></head></html>";

	it("200・HTML・タイトルに期待の文字列があれば ok", () => {
		const result = judgeWeb(200, "text/html; charset=utf-8", html, "rondo");
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("title=rondo");
	});

	it("200 以外、HTML 以外、タイトルが違う・無いときは失敗", () => {
		expect(judgeWeb(502, "text/html", html, "rondo").ok).toBe(false);
		expect(judgeWeb(200, "application/json", html, "rondo").ok).toBe(false);
		expect(
			judgeWeb(200, "text/html", "<title>Bad Gateway</title>", "rondo").ok,
		).toBe(false);
		const none = judgeWeb(200, "text/html", "<html></html>", "rondo");
		expect(none.ok).toBe(false);
		expect(none.detail).toContain("title=(なし)");
	});
});

describe("judgeManifest（issue-50）", () => {
	const origin = "https://rondo.chapy0706.com";

	it("200・許可したオリジン・max-age=60 なら ok", () => {
		expect(judgeManifest(200, origin, "public, max-age=60", origin).ok).toBe(
			true,
		);
	});

	it("オリジンが違う・無い、キャッシュが違うときは失敗し、値を出す", () => {
		expect(
			judgeManifest(200, "http://localhost:3000", "max-age=60", origin).ok,
		).toBe(false);
		const missing = judgeManifest(200, "", "", origin);
		expect(missing.ok).toBe(false);
		expect(missing.detail).toBe("200 CORS=(なし) cache=(なし)");
		expect(judgeManifest(404, origin, "max-age=60", origin).ok).toBe(false);
	});
});

describe("judgeGlb（issue-50）", () => {
	const type = "model/gltf-binary";
	const cache = "public, max-age=31536000, immutable";

	it("ヘッダが正しく、2回目が HIT なら ok（大文字小文字は問わない）", () => {
		expect(judgeGlb(200, type, cache, "HIT").ok).toBe(true);
		expect(judgeGlb(200, type, cache, "hit").ok).toBe(true);
	});

	it("2回目も MISS・DYNAMIC、または Cloudflare を通っていなければ失敗", () => {
		expect(judgeGlb(200, type, cache, "MISS").ok).toBe(false);
		expect(judgeGlb(200, type, cache, "DYNAMIC").ok).toBe(false);
		const direct = judgeGlb(200, type, cache, null);
		expect(direct.ok).toBe(false);
		expect(direct.detail).toContain("Cloudflare を通っていない");
	});

	it("型・immutable・200 のどれかが違えば、HIT でも失敗", () => {
		expect(judgeGlb(200, "application/octet-stream", cache, "HIT").ok).toBe(
			false,
		);
		expect(judgeGlb(200, type, "max-age=60", "HIT").ok).toBe(false);
		expect(judgeGlb(404, type, cache, "HIT").ok).toBe(false);
	});
});

describe("smallestAssetPath（issue-50）", () => {
	it("版付きのパスのうち、いちばん小さい素材を選ぶ", () => {
		const body = {
			assets: [
				{ path: "v1/house/hiraya-indoor-512.glb", bytes: 30_880_000 },
				{ path: "v1/test/test-cube-512.glb", bytes: 1536 },
				{ path: "v1/test/test-cube-1024.glb", bytes: 2048 },
			],
		};
		expect(smallestAssetPath(body)).toBe("v1/test/test-cube-512.glb");
	});

	it("bytes が無い素材は、ほかに候補が無いときだけ選ぶ", () => {
		expect(smallestAssetPath({ assets: [{ path: "v2/a.glb" }] })).toBe(
			"v2/a.glb",
		);
		expect(
			smallestAssetPath({
				assets: [{ path: "v2/a.glb" }, { path: "v1/b.glb", bytes: 10 }],
			}),
		).toBe("v1/b.glb");
	});

	it("形が違う、版付きでない、上の階層を指すパスは選ばない", () => {
		expect(smallestAssetPath(null)).toBeNull();
		expect(smallestAssetPath("text")).toBeNull();
		expect(smallestAssetPath({ assets: "x" })).toBeNull();
		expect(
			smallestAssetPath({
				assets: [
					{ path: "manifest.json", bytes: 1 },
					{ path: "/v1/a.glb", bytes: 1 },
					{ path: "v1/../secret.glb", bytes: 1 },
					{ path: "https://example.com/v1/a.glb", bytes: 1 },
					{ path: 3, bytes: 1 },
				],
			}),
		).toBeNull();
	});
});

describe("readEnvValues（issue-50）", () => {
	const names = ["NEXT_PUBLIC_RONDO_WS_URL", "NEXT_PUBLIC_ASSET_BASE_URL"];

	it("指定した名前だけを返し、ほかの行（秘密の値など）は返さない", () => {
		const text = [
			"# コメント",
			"NEXT_PUBLIC_RONDO_WS_URL=wss://ws.example/ws",
			"SOME_SECRET=do-not-read",
			'NEXT_PUBLIC_ASSET_BASE_URL="https://assets.example"',
		].join("\n");
		expect(readEnvValues(text, names)).toEqual({
			NEXT_PUBLIC_RONDO_WS_URL: "wss://ws.example/ws",
			NEXT_PUBLIC_ASSET_BASE_URL: "https://assets.example",
		});
	});

	it("同じ名前は最後の行を使い、空の値は無いものとして扱う", () => {
		const text = [
			"NEXT_PUBLIC_RONDO_WS_URL=wss://old/ws",
			"NEXT_PUBLIC_RONDO_WS_URL='wss://new/ws'",
			"NEXT_PUBLIC_ASSET_BASE_URL=https://assets.example",
			"NEXT_PUBLIC_ASSET_BASE_URL=",
		].join("\r\n");
		expect(readEnvValues(text, names)).toEqual({
			NEXT_PUBLIC_RONDO_WS_URL: "wss://new/ws",
		});
	});

	it("コメントにした行は読まない", () => {
		expect(
			readEnvValues("# NEXT_PUBLIC_RONDO_WS_URL=wss://x/ws", names),
		).toEqual({});
	});
});
