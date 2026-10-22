import { describe, expect, it } from "vitest";
import {
	type AudioInfo,
	BGM_FADE_IN_MS,
	BGM_STOP_FADE_MS,
	BGM_SWITCH_FADE_MS,
	MAX_VOICES,
	createSoundEngine,
} from "./engine";
import { FakeContext, type FakeSource } from "./fakeAudio";

/** 待っている Promise を進める。 */
async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const SE: AudioInfo = { kind: "se", durationMs: 2000, gain: 0.8 };
const TOP: AudioInfo = {
	kind: "bgm",
	durationMs: 64_000,
	gain: 0.7,
	loop: { startMs: 20, endMs: 61_940, crossfadeMs: 1000 },
};
const GAME: AudioInfo = {
	kind: "bgm",
	durationMs: 110_000,
	gain: 0.6,
	loop: { startMs: 20, endMs: 106_100, crossfadeMs: 2500 },
};
const PAINT: AudioInfo = {
	kind: "se",
	durationMs: 7284,
	gain: 1.5,
	loop: { startMs: 0, endMs: 6850, crossfadeMs: 0 },
};

/** 偽の素材（データの長さ＝秒）。 */
const LIBRARY: Record<string, { info: AudioInfo; bytes: number }> = {
	"bgm-top": { info: TOP, bytes: 64 },
	"bgm-game": { info: GAME, bytes: 110 },
	"se-hit": { info: SE, bytes: 2 },
	"se-count": { info: { ...SE, durationMs: 14_000 }, bytes: 14 },
	"se-paint": { info: PAINT, bytes: 7 },
};

function setup(
	options: { context?: FakeContext | null; withBeep?: boolean } = {},
) {
	const context =
		options.context === undefined ? new FakeContext() : options.context;
	const fetched: string[] = [];
	const beeps: string[] = [];
	const logs: string[] = [];
	let created = 0;
	let tick: (() => void) | null = null;
	const engine = createSoundEngine({
		createContext: () => {
			created += 1;
			return context;
		},
		fetchAudio: async (key) => {
			fetched.push(key);
			const item = LIBRARY[key];
			if (item === undefined) return null;
			return { info: item.info, data: new ArrayBuffer(item.bytes) };
		},
		beep: options.withBeep ? (_ctx, _out, key) => beeps.push(key) : null,
		log: (message) => logs.push(message),
		every: (_ms, fn) => {
			tick = fn;
			return () => {
				tick = null;
			};
		},
	});
	return {
		engine,
		context: context as FakeContext,
		fetched,
		beeps,
		logs,
		created: () => created,
		tick: () => tick?.(),
	};
}

/** BGM の系統（全体 → BGM / 効果音）につながった音源。 */
function bgmSources(context: FakeContext): FakeSource[] {
	return context.sources.filter(
		(s) => s.buffer !== null && s.buffer.duration > 50,
	);
}

describe("音の仕組み（Web Audio / issue-63）", () => {
	it("最初の操作の前は、AudioContext を作らず、取りに行かず、鳴らさない（エラーも出さない）", async () => {
		const s = setup();
		s.engine.preload(["bgm-top", "se-hit"]);
		s.engine.setBgm("bgm-top");
		const handle = s.engine.play("se-hit");
		handle.stop();
		s.engine.loop("se-paint").stop(100);
		await flush();
		expect(s.created()).toBe(0);
		expect(s.fetched).toEqual([]);
		expect(s.engine.durationMs("se-hit")).toBeUndefined();
	});

	it("最初の操作で、作って再開し、1 サンプルの無音を鳴らす。読み込みは、そのあと順番どおり", async () => {
		const s = setup();
		s.engine.preload(["bgm-top", "se-count", "se-hit"]);
		s.engine.unlock();
		expect(s.created()).toBe(1);
		expect(s.context.resumes).toBe(1);
		expect(s.context.sources[0]?.started).not.toBeNull();
		await flush();
		expect(s.fetched).toEqual(["bgm-top", "se-count", "se-hit"]);
		// 効果音は、読んだらすぐ展開する。BGM は、鳴らすときまで展開しない。
		expect(s.context.decoded).toEqual([14, 2]);
	});

	it("2 回目の操作では作り直さない。止まっていれば再開する", () => {
		const s = setup();
		s.engine.unlock();
		s.context.state = "interrupted";
		s.engine.unlock();
		expect(s.created()).toBe(1);
		expect(s.context.resumes).toBe(2);
	});

	it("AudioContext が無い端末: 何もせず、例外を出さない", async () => {
		const s = setup({ context: null });
		s.engine.unlock();
		s.engine.preload(["se-hit"]);
		s.engine.setBgm("bgm-top");
		expect(() => s.engine.play("se-hit").stop()).not.toThrow();
		await flush();
		expect(s.fetched).toEqual([]);
	});

	it("効果音: 系統につなぎ、倍率をかけて鳴らす。始める位置と待ち時間を渡せる", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.preload(["se-count"]);
		await flush();
		s.context.currentTime = 10;
		s.engine.play("se-count", { offsetMs: 3984, delayMs: 500, rate: 1.05 });
		const source = s.context.sources.at(-1) as FakeSource;
		expect(source.started).toEqual({ when: 10.5, offset: 3.984 });
		expect(source.playbackRate.value).toBe(1.05);
		expect(s.engine.durationMs("se-count")).toBe(14_000);
	});

	it("同時に鳴らす効果音は、上限（4）まで。鳴り終われば、また鳴らせる", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.preload(["se-hit"]);
		await flush();
		expect(MAX_VOICES).toBe(4);
		const before = s.context.sources.length;
		for (let i = 0; i < 6; i++) s.engine.play("se-hit");
		const started = s.context.sources.slice(before);
		expect(started).toHaveLength(4);
		started[0]?.end();
		s.engine.play("se-hit");
		expect(s.context.sources.length - before).toBe(5);
	});

	it("止めると、小さくしてから止める", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.preload(["se-paint"]);
		await flush();
		s.context.currentTime = 2;
		const handle = s.engine.loop("se-paint");
		const source = s.context.sources.at(-1) as FakeSource;
		expect(source.loop).toBe(true);
		expect(source.loopStart).toBe(0);
		expect(source.loopEnd).toBeCloseTo(6.85);
		handle.stop(150);
		// 0.15 秒で小さくし、少しの余り（0.05 秒）のあとに止める。
		expect(source.stoppedAt).toBeCloseTo(2.2);
		// 2 回止めても、例外を出さない。
		expect(() => handle.stop(150)).not.toThrow();
	});

	it("素材がない key: 鳴らさない。開発中のビープがあれば、それを鳴らす", async () => {
		const plain = setup();
		plain.engine.unlock();
		plain.engine.preload(["se-miss"]);
		await flush();
		const before = plain.context.sources.length;
		plain.engine.play("se-miss");
		expect(plain.context.sources.length).toBe(before);
		expect(plain.engine.durationMs("se-miss")).toBeNull();

		const dev = setup({ withBeep: true });
		dev.engine.unlock();
		dev.engine.preload(["se-miss"]);
		await flush();
		dev.engine.play("se-miss");
		expect(dev.beeps).toEqual(["se-miss"]);
	});

	it("壊れた素材（展開できない）・取得の失敗: 無音で続け、例外を出さない", async () => {
		const context = new FakeContext();
		context.failDecode = true;
		const s = setup({ context });
		s.engine.unlock();
		s.engine.preload(["se-hit"]);
		await flush();
		expect(() => s.engine.play("se-hit")).not.toThrow();
		expect(s.engine.durationMs("se-hit")).toBeNull();
		expect(s.logs.some((line) => line.includes("se-hit"))).toBe(true);
	});

	it("音量: 全体・BGM・効果音の系統に渡す", () => {
		const s = setup();
		s.engine.setGains({ master: 0, bgm: 0.4, se: 0.7 });
		s.engine.unlock();
		const [master, bgm, se] = s.context.gains;
		expect(master?.gain.value).toBe(0);
		expect(bgm?.gain.value).toBe(0.4);
		expect(se?.gain.value).toBe(0.7);
		s.engine.setGains({ master: 1, bgm: 0.2, se: 0.9 });
		expect(master?.gain.value).toBe(1);
		expect(bgm?.gain.value).toBe(0.2);
	});

	it("画面が見えなくなったら止め、戻ったら再開する（最初の操作の前は何もしない）", () => {
		const s = setup();
		s.engine.suspend();
		s.engine.resume();
		expect(s.created()).toBe(0);
		s.engine.unlock();
		s.engine.suspend();
		expect(s.context.suspends).toBe(1);
		s.engine.resume();
		expect(s.context.resumes).toBe(2);
	});
});

describe("BGM（issue-63）", () => {
	it("鳴らすときに展開し、繰り返しの位置から、小さい音から始める", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-top");
		await flush();
		const [first] = bgmSources(s.context);
		expect(first?.started?.when).toBe(0);
		expect(first?.started?.offset).toBeCloseTo(0.02);
		expect(first?.started?.duration).toBeCloseTo(61.92);
		expect(s.context.decoded).toEqual([64]);
		expect(BGM_FADE_IN_MS).toBeGreaterThan(0);
	});

	it("同じ BGM が続くときは、途切れず続ける（作り直さない）", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-top");
		await flush();
		s.engine.setBgm("bgm-top");
		await flush();
		expect(bgmSources(s.context)).toHaveLength(1);
	});

	it("繰り返し: 終わりの重なり（1 秒）の前に、次の回を重ねて始める", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-top");
		await flush();
		s.context.currentTime = 50;
		s.tick();
		expect(bgmSources(s.context)).toHaveLength(1);
		s.context.currentTime = 60;
		s.tick();
		const [, second] = bgmSources(s.context);
		// 1 回目は 0 秒から 61.92 秒の長さ。重なり 1 秒なので、60.92 秒に次を始める。
		expect(second?.started?.when).toBeCloseTo(60.92);
		expect(second?.started?.offset).toBeCloseTo(0.02);
	});

	it("切り替え: 前の BGM を小さくして止め、展開した形を手放す。新しい BGM を始める", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-top");
		await flush();
		s.context.currentTime = 5;
		s.engine.setBgm("bgm-game");
		await flush();
		const [top, game] = bgmSources(s.context);
		expect(top?.stoppedAt).toBeCloseTo(5 + BGM_SWITCH_FADE_MS / 1000 + 0.05);
		expect(game?.started?.when).toBe(5);
		// top に戻ると、もう一度展開する（展開した形は、いまの BGM だけ持つ）。
		s.engine.setBgm("bgm-top");
		await flush();
		expect(s.context.decoded).toEqual([64, 110, 64]);
	});

	it("結果画面（null）: 1 秒で小さくして止め、無音にする", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-game");
		await flush();
		s.context.currentTime = 30;
		s.engine.setBgm(null);
		const [game] = bgmSources(s.context);
		expect(BGM_STOP_FADE_MS).toBe(1000);
		expect(game?.stoppedAt).toBeCloseTo(31.05);
		s.context.currentTime = 200;
		s.tick();
		expect(bgmSources(s.context)).toHaveLength(1);
	});

	it("最初の操作の前に決めた BGM は、操作のあとに鳴る", async () => {
		const s = setup();
		s.engine.setBgm("bgm-top");
		await flush();
		expect(s.context.sources).toHaveLength(0);
		s.engine.unlock();
		await flush();
		expect(bgmSources(s.context)).toHaveLength(1);
	});

	it("展開の途中で別の BGM に変わったら、前のものは鳴らさない", async () => {
		const s = setup();
		s.engine.unlock();
		s.engine.setBgm("bgm-top");
		s.engine.setBgm("bgm-game");
		await flush();
		const sources = bgmSources(s.context);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.buffer?.duration).toBe(110);
	});

	it("BGM の素材がない: 無音で続ける（ビープは 1 回だけ）", async () => {
		const s = setup({ withBeep: true });
		s.engine.unlock();
		s.engine.setBgm("bgm-missing");
		await flush();
		s.tick();
		s.engine.setBgm("bgm-missing");
		expect(s.beeps).toEqual(["bgm-missing"]);
	});
});
