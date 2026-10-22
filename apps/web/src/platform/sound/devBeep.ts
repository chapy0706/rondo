/**
 * 開発中だけのビープ（issue-63）。素材がない key のとき、コードで作った短い音（0.08 秒）を鳴らす。
 * hub.ts が、開発中のビルドで、条件（beep.ts）に合うときだけ読み込む。本番のビルドには入らない
 * （目印の文字列 sound-beep が .next/static に無いことで確かめる）。
 */

import type {
	AudioContextLike,
	AudioNodeLike,
} from "../../infrastructure/audio/engine";
import { beepFrequency } from "./beep";
import { SOUND_KEYS, type SoundKey } from "./keys";

const BEEP_SECONDS = 0.08;

interface OscillatorLike {
	readonly frequency: { value: number };
	connect(node: never): unknown;
	start(when?: number): unknown;
	stop(when?: number): unknown;
}

interface BeepContext {
	createOscillator(): OscillatorLike;
}

function canBeep(context: object): context is BeepContext {
	return "createOscillator" in context;
}

function isSoundKey(key: string): key is SoundKey {
	return (SOUND_KEYS as readonly string[]).includes(key);
}

export function playBeep(
	context: AudioContextLike,
	output: AudioNodeLike,
	key: string,
): void {
	if (!canBeep(context) || !isSoundKey(key)) return;
	console.info(`[sound-beep] ${key}（素材がないので、開発用のビープ）`);
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.frequency.value = beepFrequency(key);
	gain.gain.value = 0.2;
	oscillator.connect(gain as never);
	gain.connect(output as never);
	const now = context.currentTime;
	gain.gain.setValueAtTime(0.2, now + BEEP_SECONDS * 0.8);
	gain.gain.linearRampToValueAtTime(0, now + BEEP_SECONDS);
	oscillator.start(now);
	oscillator.stop(now + BEEP_SECONDS);
}
