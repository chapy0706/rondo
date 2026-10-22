import { describe, expect, it } from "vitest";
import { judgeAudio, smallestAudioPath } from "./judge.ts";

const ORIGIN = "https://rondo.example.com";

describe("judgeAudio（issue-63）", () => {
	it("200・audio/mpeg・immutable・CORS が許可したオリジンなら通る", () => {
		const result = judgeAudio(
			200,
			"audio/mpeg",
			"public, max-age=31536000, immutable",
			ORIGIN,
			ORIGIN,
		);
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("audio/mpeg");
	});

	it("どれか 1 つでも違えば通らない", () => {
		const good = [
			200,
			"audio/mpeg",
			"public, max-age=31536000, immutable",
			ORIGIN,
		] as const;
		expect(judgeAudio(404, good[1], good[2], good[3], ORIGIN).ok).toBe(false);
		expect(
			judgeAudio(200, "application/octet-stream", good[2], good[3], ORIGIN).ok,
		).toBe(false);
		expect(judgeAudio(200, good[1], "public, max-age=60", good[3], ORIGIN).ok).toBe(
			false,
		);
		expect(judgeAudio(200, good[1], good[2], "*", ORIGIN).ok).toBe(false);
		expect(judgeAudio(200, good[1], good[2], "", ORIGIN).ok).toBe(false);
	});
});

describe("smallestAudioPath（issue-63）", () => {
	it("audio 欄の、いちばん小さい mp3 のパス", () => {
		expect(
			smallestAudioPath({
				version: 1,
				assets: [],
				audio: [
					{ path: "v1/audio/bgm-top.mp3", bytes: 1288819 },
					{ path: "v1/audio/se-miss.mp3", bytes: 9403 },
				],
			}),
		).toBe("v1/audio/se-miss.mp3");
	});

	it("audio 欄が無い（いまの本番）・空・形が違うなら null（確認を省く）", () => {
		expect(smallestAudioPath({ version: 1, assets: [] })).toBeNull();
		expect(smallestAudioPath({ version: 1, assets: [], audio: [] })).toBeNull();
		expect(smallestAudioPath({ audio: "x" })).toBeNull();
		expect(smallestAudioPath(null)).toBeNull();
	});

	it("版付きの mp3 でないパスは使わない", () => {
		expect(
			smallestAudioPath({
				audio: [
					{ path: "../secret.mp3", bytes: 1 },
					{ path: "v1/audio/x.wav", bytes: 1 },
					{ path: "v1/../x.mp3", bytes: 1 },
				],
			}),
		).toBeNull();
	});
});
