/**
 * 音を鳴らすかの旗（issue-63）。
 *
 * SOUND_READY が true なので、既定で鳴らす。端末ごとに、URL の ?sound=0 で解除し（その端末は無音の
 * まま。音の呼び出しは、すべて何もしない。素材の読み込みも、AudioContext の作成も、しない）、
 * ?sound=1 で、また鳴らす。どちらも、その端末に覚える。全員の音を止めるときは、SOUND_READY を
 * false に戻す（そのときは、?sound=1 を覚えた端末だけが鳴る）。
 */

import type { SoundStorage } from "./settings";

export const SOUND_READY = true;

export const SOUND_FLAG_KEY = "rondo.sound.enabled";

/**
 * 鳴らすか。search は location.search。?sound=1 / ?sound=0 は、端末に覚える（書けなければ、
 * その画面を開いている間だけ従う）。覚えた値（1 か 0）は、ready より優先する。
 */
export function resolveSoundFlag(
	ready: boolean,
	storage: SoundStorage | null,
	search: string,
): boolean {
	const asked = new URLSearchParams(search).get("sound");
	if (asked === "1" || asked === "0") {
		try {
			storage?.setItem(SOUND_FLAG_KEY, asked);
		} catch {
			// 覚えられなくても、この画面では URL に従う。
		}
		return asked === "1";
	}
	try {
		const stored = storage?.getItem(SOUND_FLAG_KEY);
		if (stored === "1") return true;
		if (stored === "0") return false;
	} catch {
		// 読めなければ、旗のとおり。
	}
	return ready;
}
