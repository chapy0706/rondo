/**
 * 音の仕組み（Web Audio / issue-63）。
 *
 * - AudioContext を 1 つ持つ。音は「BGM の系統」か「効果音の系統」を通り、全体の音量（ミュート）を経て
 *   出力に届く。素材ごとの倍率（manifest の gain）は、音源ごとの GainNode でかける
 * - スマホのブラウザは、利用者の操作の前に音を鳴らせない。AudioContext は、最初の操作（unlock）で作り、
 *   再開して、1 サンプルの無音を鳴らす。それより前の呼び出しは、何もしない（エラーも出さない）。
 *   素材の読み込みも、最初の操作のあとに、頼まれた順に 1 つずつ始める
 * - 効果音は、読んだらすぐ展開して持つ（小さい）。BGM は、圧縮したまま持ち、鳴らすときに展開する。
 *   展開した形は、いまの BGM だけ持つ（切り替えたら手放す。iPhone のメモリのため）
 * - BGM の繰り返しは、manifest の loop（始まり・終わり・重なり）のとおりに、次の回を重ねて始める
 *   （素材を作り直さずに、継ぎ目を変えられる）。切り替えは、前を小さくして止め、新しいものを始める
 * - 同時に鳴らす効果音は、上限（MAX_VOICES）まで。BGM は数えない
 * - 素材がない・読めない・展開できない・AudioContext が無い、のどれでも、無音で続ける。原因は log に
 *   記録する。開発中だけ、素材がない key で beep を鳴らせる（本番では渡さない）
 *
 * ブラウザの型に直接は頼らず、使う部分だけの型（〜Like）で受ける（偽の AudioContext で確かめるため）。
 * 鍵（key）の意味は知らない（素材の種類は manifest の kind で決まる）。
 */

export interface AudioParamLike {
	value: number;
	setValueAtTime(value: number, time: number): unknown;
	linearRampToValueAtTime(value: number, time: number): unknown;
	cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
	connect(node: never): unknown;
	disconnect(): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
	readonly gain: AudioParamLike;
}

export interface AudioBufferLike {
	readonly duration: number;
}

export interface BufferSourceLike extends AudioNodeLike {
	buffer: AudioBufferLike | null;
	loop: boolean;
	loopStart: number;
	loopEnd: number;
	readonly playbackRate: AudioParamLike;
	onended: ((event: Event) => unknown) | null;
	start(when?: number, offset?: number, duration?: number): unknown;
	stop(when?: number): unknown;
}

export interface AudioContextLike {
	readonly currentTime: number;
	readonly state: string;
	readonly destination: AudioNodeLike;
	createGain(): GainNodeLike;
	createBufferSource(): BufferSourceLike;
	createBuffer(channels: number, length: number, rate: number): AudioBufferLike;
	decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
	resume(): Promise<unknown>;
	suspend(): Promise<unknown>;
	close(): Promise<unknown>;
}

/** 素材の情報（manifest の audio 欄の、鳴らすのに使う部分）。 */
export interface AudioInfo {
	readonly kind: "bgm" | "se";
	readonly durationMs: number;
	readonly gain: number;
	readonly loop?:
		| {
				readonly startMs: number;
				readonly endMs: number;
				readonly crossfadeMs: number;
		  }
		| undefined;
}

export interface SoundEngineDeps {
	/** AudioContext を作る。使えない端末では null。 */
	readonly createContext: () => AudioContextLike | null;
	/** 素材を取る。manifest に無い・取れないときは null。 */
	readonly fetchAudio: (
		key: string,
	) => Promise<{ readonly info: AudioInfo; readonly data: ArrayBuffer } | null>;
	/** 素材がない key のときに鳴らすビープ（開発中だけ。本番は null）。 */
	readonly beep:
		| ((context: AudioContextLike, output: AudioNodeLike, key: string) => void)
		| null;
	readonly log: (message: string) => void;
	/** 一定の間隔で fn を呼ぶ（BGM の次の回の予約）。返り値は止める関数。 */
	readonly every: (ms: number, fn: () => void) => () => void;
}

export interface SoundHandle {
	/** 止める。fadeMs で小さくしてから止める。2 回呼んでもよい。 */
	stop(fadeMs?: number): void;
}

export interface SoundEngine {
	unlock(): void;
	preload(keys: readonly string[]): void;
	setGains(gains: {
		readonly master: number;
		readonly bgm: number;
		readonly se: number;
	}): void;
	setBgm(key: string | null): void;
	play(
		key: string,
		options?: {
			readonly rate?: number;
			readonly offsetMs?: number;
			readonly delayMs?: number;
		},
	): SoundHandle;
	loop(key: string): SoundHandle;
	/** 素材の長さ。読み込み中・まだ頼んでいないなら undefined、素材がないなら null。 */
	durationMs(key: string): number | null | undefined;
	suspend(): void;
	resume(): void;
	close(): void;
}

/** 同時に鳴らす効果音の上限。 */
export const MAX_VOICES = 4;
/** BGM を切り替えるとき、前の BGM を小さくする長さ。 */
export const BGM_SWITCH_FADE_MS = 1000;
/** BGM を止める（結果画面）とき、小さくする長さ。 */
export const BGM_STOP_FADE_MS = 1000;
/** BGM を始めるときに、大きくする長さ（始まりの音の跳ねを避ける）。 */
export const BGM_FADE_IN_MS = 300;
/** BGM の次の回を予約する間隔と、どれだけ前に予約するか。 */
const BGM_TICK_MS = 250;
const BGM_LEAD_S = 1;
/** 止めてから、音源を止めるまでの余り（小さくし終えてから止める）。 */
const STOP_MARGIN_S = 0.05;

type Asset =
	| { readonly state: "loading" }
	| { readonly state: "missing" }
	| {
			readonly state: "ready";
			readonly info: AudioInfo;
			/** 圧縮したままのバイト列（BGM の展開し直しに使う）。 */
			readonly data: ArrayBuffer;
			/** 展開した形（効果音は常に、BGM は鳴らしている間だけ）。 */
			buffer: AudioBufferLike | null;
	  };

interface Segment {
	readonly source: BufferSourceLike;
	readonly gain: GainNodeLike;
}

interface BgmPlayback {
	readonly key: string;
	readonly segments: Segment[];
	/** 展開した形（展開中・素材がないなら null）。 */
	buffer: AudioBufferLike | null;
	/** 次の回を始める時刻（AudioContext の時計）。 */
	nextAt: number;
	readonly gain: number;
	/** 繰り返しの位置（秒。展開してから決める）。 */
	loop: { start: number; end: number; crossfade: number } | null;
}

interface Buses {
	readonly master: GainNodeLike;
	readonly bgm: GainNodeLike;
	readonly se: GainNodeLike;
}

const NOOP: SoundHandle = { stop: () => {} };

export function createSoundEngine(deps: SoundEngineDeps): SoundEngine {
	let context: AudioContextLike | null = null;
	let buses: Buses | null = null;
	/** AudioContext が作れなかった（この端末では鳴らさない）。 */
	let unavailable = false;
	let gains = { master: 1, bgm: 1, se: 1 };
	const assets = new Map<string, Asset>();
	const queue: string[] = [];
	let loading = false;
	let wantedBgm: string | null = null;
	let bgm: BgmPlayback | null = null;
	let stopTick: (() => void) | null = null;
	let voices = 0;

	/** 音の失敗は、ゲームを止めない。例外は記録して捨てる。 */
	const safe = <T>(what: string, fallback: T, fn: () => T): T => {
		try {
			return fn();
		} catch (error) {
			deps.log(`[sound] ${what}: ${String(error)}（無音で続けます）`);
			return fallback;
		}
	};

	const beep = (key: string) => {
		if (deps.beep === null || context === null || buses === null) return;
		deps.beep(context, buses.se, key);
	};

	const applyGains = () => {
		if (buses === null) return;
		buses.master.gain.value = gains.master;
		buses.bgm.gain.value = gains.bgm;
		buses.se.gain.value = gains.se;
	};

	/** 小さくしてから止める。 */
	const fadeOut = (
		ctx: AudioContextLike,
		node: Segment,
		fadeMs: number,
	): void => {
		const now = ctx.currentTime;
		const end = now + Math.max(0, fadeMs) / 1000;
		node.gain.gain.cancelScheduledValues(now);
		node.gain.gain.setValueAtTime(node.gain.gain.value, now);
		node.gain.gain.linearRampToValueAtTime(0, end);
		node.source.stop(end + STOP_MARGIN_S);
	};

	// --- 読み込み -----------------------------------------------------------------------

	const loadOne = async (key: string): Promise<void> => {
		assets.set(key, { state: "loading" });
		let result: Awaited<ReturnType<SoundEngineDeps["fetchAudio"]>> = null;
		try {
			result = await deps.fetchAudio(key);
		} catch (error) {
			deps.log(`[sound] ${key} を取れない: ${String(error)}（無音で続けます）`);
		}
		if (result === null) {
			assets.set(key, { state: "missing" });
			return;
		}
		let buffer: AudioBufferLike | null = null;
		if (result.info.kind === "se" && context !== null) {
			try {
				// 展開は、渡したバイト列を手放す（detach）ので、写しを渡す。
				buffer = await context.decodeAudioData(result.data.slice(0));
			} catch (error) {
				deps.log(
					`[sound] ${key} を展開できない: ${String(error)}（無音で続けます）`,
				);
				assets.set(key, { state: "missing" });
				return;
			}
		}
		assets.set(key, {
			state: "ready",
			info: result.info,
			data: result.data,
			buffer,
		});
	};

	const pump = async (): Promise<void> => {
		if (loading || context === null) return;
		loading = true;
		try {
			for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
				await loadOne(key);
				if (key === wantedBgm) safe("BGM", undefined, applyBgm);
			}
		} finally {
			loading = false;
		}
	};

	const preload = (keys: readonly string[]) => {
		for (const key of keys) {
			if (!assets.has(key) && !queue.includes(key)) queue.push(key);
		}
		void pump();
	};

	// --- BGM ---------------------------------------------------------------------------

	const loopOf = (
		info: AudioInfo,
		buffer: AudioBufferLike,
	): { start: number; end: number; crossfade: number } => {
		const whole = { start: 0, end: buffer.duration, crossfade: 0 };
		if (info.loop === undefined) return whole;
		const start = info.loop.startMs / 1000;
		const end = Math.min(info.loop.endMs / 1000, buffer.duration);
		const crossfade = info.loop.crossfadeMs / 1000;
		return end - start > crossfade && start >= 0 && crossfade >= 0
			? { start, end, crossfade }
			: whole;
	};

	const startSegment = (
		ctx: AudioContextLike,
		out: Buses,
		playback: BgmPlayback,
		at: number,
		offset: number,
		fadeIn: number,
	) => {
		const { buffer, loop } = playback;
		if (buffer === null || loop === null) return;
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, at);
		gain.gain.linearRampToValueAtTime(playback.gain, at + fadeIn);
		source.connect(gain as never);
		gain.connect(out.bgm as never);
		const length = Math.max(0, loop.end - offset);
		source.start(at, offset, length);
		const next = at + length - loop.crossfade;
		if (loop.crossfade > 0) {
			gain.gain.setValueAtTime(playback.gain, next);
			gain.gain.linearRampToValueAtTime(0, at + length);
		}
		const segment = { source, gain };
		source.onended = () => {
			safe("BGM の後始末", undefined, () => {
				gain.disconnect();
				const index = playback.segments.indexOf(segment);
				if (index >= 0) playback.segments.splice(index, 1);
			});
		};
		playback.segments.push(segment);
		playback.nextAt = next;
	};

	/** 次の回を、重なりの分だけ前に始める。 */
	const tick = () => {
		safe("BGM の予約", undefined, () => {
			if (context === null || buses === null || bgm === null) return;
			if (bgm.buffer === null || bgm.loop === null) return;
			if (context.state !== "running") return;
			if (context.currentTime < bgm.nextAt - BGM_LEAD_S) return;
			const at = Math.max(bgm.nextAt, context.currentTime);
			startSegment(context, buses, bgm, at, bgm.loop.start, bgm.loop.crossfade);
		});
	};

	const stopBgm = (playback: BgmPlayback, fadeMs: number) => {
		if (context === null) return;
		for (const segment of playback.segments) fadeOut(context, segment, fadeMs);
		playback.nextAt = Number.POSITIVE_INFINITY;
		const asset = assets.get(playback.key);
		// 展開した形を手放す（圧縮したバイト列は残す）。
		if (asset?.state === "ready" && asset.info.kind === "bgm") {
			asset.buffer = null;
		}
	};

	function applyBgm(): void {
		const ctx = context;
		const out = buses;
		if (ctx === null || out === null) return;
		if (bgm !== null && bgm.key === wantedBgm) return;
		if (bgm !== null) {
			stopBgm(bgm, wantedBgm === null ? BGM_STOP_FADE_MS : BGM_SWITCH_FADE_MS);
			bgm = null;
		}
		const key = wantedBgm;
		if (key === null) return;
		const asset = assets.get(key);
		if (asset === undefined) {
			preload([key]);
			return;
		}
		if (asset.state === "loading") return;
		if (asset.state === "missing") {
			// 素材がなくても、鳴らしている扱いにする（同じ BGM で、ビープを繰り返さない）。
			bgm = {
				key,
				segments: [],
				buffer: null,
				nextAt: Number.POSITIVE_INFINITY,
				gain: 0,
				loop: null,
			};
			beep(key);
			return;
		}
		const playback: BgmPlayback = {
			key,
			segments: [],
			buffer: null,
			nextAt: Number.POSITIVE_INFINITY,
			gain: asset.info.gain,
			loop: null,
		};
		bgm = playback;
		const info = asset.info;
		ctx
			.decodeAudioData(asset.data.slice(0))
			.then((buffer) => {
				// 展開の途中で、別の BGM に変わったら鳴らさない。
				if (bgm !== playback) return;
				asset.buffer = buffer;
				playback.buffer = buffer;
				const loop = loopOf(info, buffer);
				playback.loop = loop;
				safe("BGM", undefined, () =>
					startSegment(
						ctx,
						out,
						playback,
						ctx.currentTime,
						loop.start,
						BGM_FADE_IN_MS / 1000,
					),
				);
			})
			.catch((error: unknown) => {
				deps.log(
					`[sound] ${key} を展開できない: ${String(error)}（無音で続けます）`,
				);
			});
	}

	// --- 効果音 -------------------------------------------------------------------------

	const startSe = (
		key: string,
		setup: (
			source: BufferSourceLike,
			info: AudioInfo,
			ctx: AudioContextLike,
		) => void,
	): SoundHandle => {
		const ctx = context;
		const out = buses;
		if (ctx === null || out === null) return NOOP;
		const asset = assets.get(key);
		if (asset === undefined || asset.state === "loading") return NOOP;
		if (asset.state === "missing") {
			beep(key);
			return NOOP;
		}
		if (asset.buffer === null || voices >= MAX_VOICES) return NOOP;
		const source = ctx.createBufferSource();
		source.buffer = asset.buffer;
		const gain = ctx.createGain();
		gain.gain.value = asset.info.gain;
		source.connect(gain as never);
		gain.connect(out.se as never);
		voices += 1;
		let ended = false;
		const finish = () => {
			if (ended) return;
			ended = true;
			voices -= 1;
			safe("効果音の後始末", undefined, () => gain.disconnect());
		};
		source.onended = finish;
		setup(source, asset.info, ctx);
		let stopped = false;
		return {
			stop: (fadeMs = 0) => {
				if (stopped) return;
				stopped = true;
				safe("効果音を止める", undefined, () =>
					fadeOut(ctx, { source, gain }, fadeMs),
				);
			},
		};
	};

	return {
		unlock() {
			safe("音の準備", undefined, () => {
				if (unavailable) return;
				if (context === null) {
					context = deps.createContext();
					if (context === null) {
						unavailable = true;
						deps.log("[sound] AudioContext が無い（無音で続けます）");
						return;
					}
					const master = context.createGain();
					const bgmBus = context.createGain();
					const seBus = context.createGain();
					bgmBus.connect(master as never);
					seBus.connect(master as never);
					master.connect(context.destination as never);
					buses = { master, bgm: bgmBus, se: seBus };
					applyGains();
					// iPhone は、操作の中で 1 度鳴らした AudioContext だけを鳴らせる。
					const prime = context.createBufferSource();
					prime.buffer = context.createBuffer(1, 1, 22_050);
					prime.connect(context.destination as never);
					prime.start(0);
					stopTick = deps.every(BGM_TICK_MS, tick);
				}
				if (context.state !== "running" && context.state !== "closed") {
					context.resume().catch(() => {});
				}
				void pump();
				applyBgm();
			});
		},
		preload(keys) {
			safe("読み込み", undefined, () => preload(keys));
		},
		setGains(next) {
			gains = { ...next };
			safe("音量", undefined, applyGains);
		},
		setBgm(key) {
			wantedBgm = key;
			safe("BGM", undefined, applyBgm);
		},
		play(key, options = {}) {
			return safe("効果音", NOOP, () =>
				startSe(key, (source, info, ctx) => {
					source.playbackRate.value = options.rate ?? 1;
					const offset = Math.min(
						Math.max(0, (options.offsetMs ?? 0) / 1000),
						info.durationMs / 1000,
					);
					source.start(
						ctx.currentTime + Math.max(0, (options.delayMs ?? 0) / 1000),
						offset,
					);
				}),
			);
		},
		loop(key) {
			return safe("効果音", NOOP, () =>
				startSe(key, (source, info, ctx) => {
					source.loop = true;
					if (info.loop !== undefined) {
						source.loopStart = info.loop.startMs / 1000;
						source.loopEnd = info.loop.endMs / 1000;
					}
					source.start(ctx.currentTime, source.loopStart);
				}),
			);
		},
		durationMs(key) {
			const asset = assets.get(key);
			if (asset === undefined || asset.state === "loading") return undefined;
			if (asset.state === "missing") return null;
			return asset.info.durationMs;
		},
		suspend() {
			safe("止める", undefined, () => {
				context?.suspend().catch(() => {});
			});
		},
		resume() {
			safe("再開", undefined, () => {
				if (context !== null && context.state !== "closed") {
					context.resume().catch(() => {});
				}
			});
		},
		close() {
			safe("後始末", undefined, () => {
				stopTick?.();
				stopTick = null;
				context?.close().catch(() => {});
				context = null;
				buses = null;
				bgm = null;
				assets.clear();
				queue.length = 0;
			});
		},
	};
}
