/**
 * 音の入口（issue-63）。アプリ全体で 1 つ（BGM はページをまたいで続くため）。
 *
 * - 旗（flag.ts）が無い間は、エンジンを作らず、どの呼び出しも何もしない（素材の読み込みも、
 *   AudioContext の作成も、しない）
 * - 呼び出しは、すべて try/catch で囲む。音の失敗が、ゲームの画面を壊さない
 * - いまの BGM は、場面（画面のパス・ゲームの知らせ・結果画面）から bgm.ts で決める
 * - 設定（settings.ts）を持ち、変えたら端末に覚えて、エンジンへ渡す
 *
 * 画面からは SoundRoot（configure・unlock・setHidden）と、ゲームのフック（setGameBgm・play・loop・
 * durationMs）、PlayHost（setResult）、設定の画面（snapshot・subscribe・updateSettings）が使う。
 */

import { loadAudio } from "../../infrastructure/assets";
import {
	type AudioContextLike,
	type AudioNodeLike,
	type SoundEngine,
	createSoundEngine,
} from "../../infrastructure/audio/engine";
import { beepEnabled } from "./beep";
import { bgmFor, preloadKeysFor } from "./bgm";
import type { BgmKey, SeKey } from "./keys";
import {
	type SoundSettings,
	type SoundStorage,
	busGains,
	loadSoundSettings,
	saveSoundSettings,
	soundStorage,
} from "./settings";

export interface SoundHandle {
	stop(fadeMs?: number): void;
}

export interface SoundSnapshot {
	readonly enabled: boolean;
	readonly settings: SoundSettings;
}

export interface SoundHub {
	/** 旗と、いまの画面のパス（SoundRoot が、画面を移るたびに呼ぶ）。 */
	configure(enabled: boolean, path: string): void;
	/** 利用者の操作（最初のタップなど）。 */
	unlock(): void;
	setHidden(hidden: boolean): void;
	/** ゲームが知らせる BGM（undefined は、知らせを取り下げる）。 */
	setGameBgm(key: BgmKey | null | undefined): void;
	setResult(shown: boolean): void;
	play(
		key: SeKey,
		options?: { rate?: number; offsetMs?: number; delayMs?: number },
	): SoundHandle;
	loop(key: SeKey): SoundHandle;
	/** 素材の長さ。分からない（読み込み中・旗なし）なら undefined、素材がないなら null。 */
	durationMs(key: SeKey): number | null | undefined;
	snapshot(): SoundSnapshot;
	subscribe(listener: () => void): () => void;
	updateSettings(next: SoundSettings): void;
}

const NOOP: SoundHandle = { stop: () => {} };

export function createSoundHub(deps: {
	readonly createEngine: () => SoundEngine;
	readonly storage: () => SoundStorage | null;
}): SoundHub {
	let engine: SoundEngine | null = null;
	let path = "/";
	let game: BgmKey | null | undefined;
	let result = false;
	let snapshot: SoundSnapshot = {
		enabled: false,
		settings: loadSoundSettings(null),
	};
	const listeners = new Set<() => void>();

	const notify = () => {
		for (const listener of listeners) listener();
	};

	/** 旗があるときだけ、例外を外へ出さずに呼ぶ。 */
	const call = <T>(fallback: T, fn: (e: SoundEngine) => T): T => {
		if (engine === null) return fallback;
		try {
			return fn(engine);
		} catch (error) {
			console.info(`[sound] ${String(error)}（無音で続けます）`);
			return fallback;
		}
	};

	const syncBgm = () => {
		call(undefined, (e) => e.setBgm(bgmFor({ path, game, result })));
	};

	return {
		configure(enabled, nextPath) {
			path = nextPath;
			if (!enabled) {
				if (engine !== null) {
					call(undefined, (e) => e.close());
					engine = null;
					snapshot = { ...snapshot, enabled: false };
					notify();
				}
				return;
			}
			if (engine === null) {
				try {
					engine = deps.createEngine();
				} catch (error) {
					console.info(`[sound] ${String(error)}（無音で続けます）`);
					return;
				}
				const settings = loadSoundSettings(deps.storage());
				snapshot = { enabled: true, settings };
				call(undefined, (e) => e.setGains(busGains(settings)));
				notify();
			}
			call(undefined, (e) => e.preload(preloadKeysFor(path)));
			syncBgm();
		},
		unlock() {
			call(undefined, (e) => e.unlock());
		},
		setHidden(hidden) {
			call(undefined, (e) => (hidden ? e.suspend() : e.resume()));
		},
		setGameBgm(key) {
			game = key;
			syncBgm();
		},
		setResult(shown) {
			result = shown;
			syncBgm();
		},
		play(key, options) {
			return call(NOOP, (e) => e.play(key, options));
		},
		loop(key) {
			return call(NOOP, (e) => e.loop(key));
		},
		durationMs(key) {
			return call<number | null | undefined>(undefined, (e) =>
				e.durationMs(key),
			);
		},
		snapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		updateSettings(next) {
			snapshot = { ...snapshot, settings: next };
			saveSoundSettings(deps.storage(), next);
			call(undefined, (e) => e.setGains(busGains(next)));
			notify();
		},
	};
}

// --- 本番（ブラウザ） ----------------------------------------------------------------

type BeepFn = (
	context: AudioContextLike,
	output: AudioNodeLike,
	key: string,
) => void;

/** 開発中だけのビープ。本番のビルドでは、この分岐ごと消える（devBeep.ts は入らない）。 */
function loadBeep(set: (fn: BeepFn) => void): void {
	if (process.env.NODE_ENV === "production") return;
	const on = beepEnabled({
		nodeEnv: process.env.NODE_ENV,
		dev: process.env.NEXT_PUBLIC_VERYARE_HIRAYA === "1",
		search: window.location.search,
	});
	if (!on) return;
	import("./devBeep").then((module) => set(module.playBeep)).catch(() => {});
}

function browserContext(): AudioContextLike | null {
	const holder = window as unknown as {
		AudioContext?: new () => AudioContextLike;
		webkitAudioContext?: new () => AudioContextLike;
	};
	const Context = holder.AudioContext ?? holder.webkitAudioContext;
	if (Context === undefined) return null;
	// iPhone の無音スイッチに従う（公共の場への配慮）。使えない端末では何もしない。
	try {
		const session = (navigator as { audioSession?: { type: string } })
			.audioSession;
		if (session !== undefined) session.type = "ambient";
	} catch {
		// 設定できなくても鳴らせる。
	}
	return new Context();
}

function browserEngine(): SoundEngine {
	let beep: BeepFn | null = null;
	loadBeep((fn) => {
		beep = fn;
	});
	return createSoundEngine({
		createContext: browserContext,
		fetchAudio: loadAudio,
		beep: (context, output, key) => beep?.(context, output, key),
		log: (message) => console.info(message),
		every: (ms, fn) => {
			const timer = window.setInterval(fn, ms);
			return () => window.clearInterval(timer);
		},
	});
}

export const soundHub: SoundHub = createSoundHub({
	createEngine: browserEngine,
	storage: soundStorage,
});
