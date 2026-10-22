/**
 * 開発中だけのビープの条件（issue-63）。素材がない key のとき、コードで作った短い音を鳴らして、
 * 仕組みを確かめられるようにする。本番（NODE_ENV が production）では、どの条件でも無効。
 * 音を作る部分（devBeep.ts）は、本番のビルドに入らないように、開発中だけ読み込む（hub.ts）。
 */

import type { SoundKey } from "./keys";

export function beepEnabled(options: {
	readonly nodeEnv: string | undefined;
	readonly dev: boolean;
	readonly search: string;
}): boolean {
	if (options.nodeEnv !== "development" && options.nodeEnv !== "test") {
		return false;
	}
	return options.dev || new URLSearchParams(options.search).get("roof") === "1";
}

const FREQUENCIES: Readonly<Record<SoundKey, number>> = {
	"bgm-top": 330,
	"bgm-game": 220,
	"se-hit": 880,
	"se-miss": 260,
	"se-count": 660,
	"se-start": 990,
	"se-paint": 1320,
};

/** 音ごとのビープの高さ（Hz）。 */
export function beepFrequency(key: SoundKey): number {
	return FREQUENCIES[key];
}
