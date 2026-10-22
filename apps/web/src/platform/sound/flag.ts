/**
 * 音を鳴らすかの旗（issue-63）。
 *
 * SOUND_READY が false の間、音の呼び出しは、すべて何もしない（素材の読み込みも、AudioContext の
 * 作成も、しない）。来場者の画面には、何も起きない。確かめるときだけ、URL に ?sound=1 を付けると、
 * その端末に覚えて鳴らす（?sound=0 で解除）。鳴らすのを全員に広げるときは、SOUND_READY を true にする。
 */

import type { SoundStorage } from "./settings";

export const SOUND_READY = false;

export const SOUND_FLAG_KEY = "rondo.sound.enabled";

/**
 * 鳴らすか。search は location.search。?sound=1 / ?sound=0 は、端末に覚える（書けなければ、
 * その画面を開いている間だけ従う）。
 */
export function resolveSoundFlag(
	ready: boolean,
	storage: SoundStorage | null,
	search: string,
): boolean {
	const asked = new URLSearchParams(search).get("sound");
	if (asked === "1" || asked === "0") {
		try {
			if (asked === "1") storage?.setItem(SOUND_FLAG_KEY, "1");
			else storage?.removeItem(SOUND_FLAG_KEY);
		} catch {
			// 覚えられなくても、この画面では URL に従う。
		}
		return ready || asked === "1";
	}
	if (ready) return true;
	try {
		return storage?.getItem(SOUND_FLAG_KEY) === "1";
	} catch {
		return false;
	}
}
