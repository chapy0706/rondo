/**
 * 音の設定（issue-63）: BGM の音量、効果音の音量、全部のミュート。選んだ値は、その端末に覚える
 * （localStorage。ceilingSetting.ts と同じく try/catch で囲み、使えなくても既定で動く）。
 *
 * 既定は、BGM と効果音を、同じ 0.35 にする（発表会の会場の騒がしさを考えて、全体は控えめ）。素材ごとの
 * 倍率（gain）が効果音の側で大きいので、スライダーの値が同じでも、効果音の方が大きく聞こえる。BGM を
 * 0.2 にしたときは、会場で BGM が聞こえなかったため、0.35 に上げた（issue-63 の続き / 2026-10-26）。
 */

export const SOUND_SETTINGS_KEY = "rondo.sound.settings";

export interface SoundSettings {
	/** BGM の音量（0〜1）。 */
	readonly bgm: number;
	/** 効果音の音量（0〜1）。 */
	readonly se: number;
	readonly muted: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
	bgm: 0.35,
	se: 0.35,
	muted: false,
};

/** localStorage のうち、使う部分（テストで差し替える）。 */
export interface SoundStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function volume(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(1, Math.max(0, value));
}

/** 覚えた値を読む。無い・読めない・壊れているなら既定。範囲の外は端に直す。 */
export function loadSoundSettings(storage: SoundStorage | null): SoundSettings {
	try {
		const raw = storage?.getItem(SOUND_SETTINGS_KEY);
		if (raw == null) return DEFAULT_SOUND_SETTINGS;
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) {
			return DEFAULT_SOUND_SETTINGS;
		}
		const { bgm, se, muted } = value as Record<string, unknown>;
		return {
			bgm: volume(bgm, DEFAULT_SOUND_SETTINGS.bgm),
			se: volume(se, DEFAULT_SOUND_SETTINGS.se),
			muted: muted === true,
		};
	} catch {
		return DEFAULT_SOUND_SETTINGS;
	}
}

/** 選んだ値を覚える。書けなければ何もしない。 */
export function saveSoundSettings(
	storage: SoundStorage | null,
	settings: SoundSettings,
): void {
	try {
		storage?.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// 使えない端末（プライベートモードなど）では、覚えない。
	}
}

/** 系統（全体・BGM・効果音）の音量。ミュートは全体を 0 にする。 */
export function busGains(settings: SoundSettings): {
	readonly master: number;
	readonly bgm: number;
	readonly se: number;
} {
	return {
		master: settings.muted ? 0 : 1,
		bgm: settings.bgm,
		se: settings.se,
	};
}

/** 本番の localStorage（無い・触れない環境では null）。 */
export function soundStorage(): SoundStorage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}
