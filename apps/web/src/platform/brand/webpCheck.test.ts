import { describe, expect, it } from "vitest";
import { MAX_LOGO_WEBP_BYTES, checkLogoWebp, webpSize } from "./webpCheck";

/** RIFF の入れ物に、1 つのチャンク（fourcc と中身）を入れた WebP。 */
function riff(fourcc: string, body: number[], padTo = 0): Uint8Array {
	const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
	const le32 = (n: number) => [
		n & 255,
		(n >> 8) & 255,
		(n >> 16) & 255,
		n >>> 24,
	];
	const chunk = [...ascii(fourcc), ...le32(body.length), ...body];
	const bytes = [
		...ascii("RIFF"),
		...le32(4 + chunk.length),
		...ascii("WEBP"),
		...chunk,
	];
	while (bytes.length < padTo) bytes.push(0);
	return Uint8Array.from(bytes);
}

/** 非可逆（VP8）。幅と高さは、開始の印（9d 01 2a）のあとに 14 ビットずつ。 */
function vp8(width: number, height: number, padTo = 0): Uint8Array {
	return riff(
		"VP8 ",
		[
			0x10,
			0x02,
			0x00,
			0x9d,
			0x01,
			0x2a,
			width & 255,
			width >> 8,
			height & 255,
			height >> 8,
		],
		padTo,
	);
}

/** 可逆（VP8L）。印（0x2f）のあとに、幅 - 1 と高さ - 1 を 14 ビットずつ。 */
function vp8l(width: number, height: number): Uint8Array {
	const bits = (width - 1) | ((height - 1) << 14);
	return riff("VP8L", [
		0x2f,
		bits & 255,
		(bits >> 8) & 255,
		(bits >> 16) & 255,
		bits >>> 24,
	]);
}

/** 拡張（VP8X）。印のあと、キャンバスの幅 - 1 と高さ - 1 を 24 ビットずつ。 */
function vp8x(width: number, height: number): Uint8Array {
	const w = width - 1;
	const h = height - 1;
	return riff("VP8X", [
		0,
		0,
		0,
		0,
		w & 255,
		(w >> 8) & 255,
		w >> 16,
		h & 255,
		(h >> 8) & 255,
		h >> 16,
	]);
}

describe("webpSize - WebP のヘッダーから、幅と高さを読む", () => {
	it("非可逆（VP8）・可逆（VP8L）・拡張（VP8X）の、どれでも読める", () => {
		expect(webpSize(vp8(512, 512))).toEqual({ width: 512, height: 512 });
		expect(webpSize(vp8(640, 480))).toEqual({ width: 640, height: 480 });
		expect(webpSize(vp8l(512, 512))).toEqual({ width: 512, height: 512 });
		expect(webpSize(vp8l(300, 200))).toEqual({ width: 300, height: 200 });
		expect(webpSize(vp8x(512, 512))).toEqual({ width: 512, height: 512 });
		expect(webpSize(vp8x(1024, 768))).toEqual({ width: 1024, height: 768 });
	});

	it("VP8 の幅と高さの上の 2 ビット（拡大の印）は、大きさに含めない", () => {
		const bytes = vp8(512, 512);
		bytes[27] = (bytes[27] ?? 0) | 0xc0;
		bytes[29] = (bytes[29] ?? 0) | 0x40;
		expect(webpSize(bytes)).toEqual({ width: 512, height: 512 });
	});

	it("WebP でない・短すぎる・印が違うものは、読めない（null）", () => {
		expect(webpSize(new Uint8Array())).toBeNull();
		expect(webpSize(vp8(512, 512).slice(0, 20))).toBeNull();
		const png = Uint8Array.from([
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a,
			...new Array(30).fill(0),
		]);
		expect(webpSize(png)).toBeNull();
		const badStart = vp8(512, 512);
		badStart[23] = 0;
		expect(webpSize(badStart)).toBeNull();
		const badSignature = vp8l(512, 512);
		badSignature[20] = 0;
		expect(webpSize(badSignature)).toBeNull();
		expect(webpSize(riff("ALPH", new Array(10).fill(0)))).toBeNull();
	});
});

describe("checkLogoWebp - ロゴの WebP の決まり（512 × 512、200 KB 以下）", () => {
	it("決まりどおりなら、問題なし", () => {
		expect(checkLogoWebp(vp8(512, 512))).toEqual([]);
		expect(checkLogoWebp(vp8l(512, 512))).toEqual([]);
	});

	it("512 × 512 でなければ、問題", () => {
		expect(checkLogoWebp(vp8(1024, 1024))).toContain(
			"幅と高さが 512 × 512 でない（1024 × 1024）",
		);
		expect(checkLogoWebp(vp8x(512, 256))).toContain(
			"幅と高さが 512 × 512 でない（512 × 256）",
		);
	});

	it("200 KB を超えれば、問題（ちょうど 200 KB は通る）", () => {
		expect(MAX_LOGO_WEBP_BYTES).toBe(200 * 1024);
		expect(checkLogoWebp(vp8(512, 512, MAX_LOGO_WEBP_BYTES))).toEqual([]);
		expect(checkLogoWebp(vp8(512, 512, MAX_LOGO_WEBP_BYTES + 1))).toContain(
			"200 KB を超えている",
		);
	});

	it("WebP として読めなければ、問題", () => {
		expect(checkLogoWebp(new TextEncoder().encode("<svg/>"))).toEqual([
			"WebP として読めない",
		]);
	});
});
