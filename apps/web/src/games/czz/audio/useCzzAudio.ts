"use client";

/**
 * czz の音（BGM と効果音）。本家の BeginnerBgmController と useSfx を、画面（Screen）で
 * 曲を選ぶ形にまとめたもの。設定はメモリ上だけで持ち、保存しない（ADR 0019）。
 * 効果音は本家と同じく初心者モードで、控えめな音量（0.25）で鳴らす。
 */

import { useCallback, useEffect, useRef } from "react";
import { ASSETS, type BgmTrack, type UiMode } from "../presentation";
import { BgmPlayer } from "./BgmPlayer";

/** 本家の「爆音の保険」。効果音の音量は控えめにする。 */
const SFX_VOLUME = 0.25;

export type SfxName = keyof typeof ASSETS.sfx;

/** 画面が決めた曲を流し、czz を離れたら止める。 */
export function useBgm(track: BgmTrack | null): void {
	const playerRef = useRef<BgmPlayer | null>(null);

	useEffect(() => {
		const player = new BgmPlayer();
		playerRef.current = player;
		return () => {
			player.stop();
			playerRef.current = null;
		};
	}, []);

	const src = track?.src ?? null;
	const loop = track?.loop ?? false;
	const volume = track?.volume ?? 0;
	useEffect(() => {
		void playerRef.current?.setTrack(
			src === null ? null : { src, loop, volume },
		);
	}, [src, loop, volume]);
}

/** 効果音を鳴らす関数を返す。初心者モードで効果音がオンのときだけ鳴る。 */
export function useSfx(settings: {
	readonly mode: UiMode;
	readonly sfxEnabled: boolean;
}): (name: SfxName) => void {
	const enabled = settings.mode === "beginner" && settings.sfxEnabled;
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	return useCallback((name: SfxName) => {
		if (!enabledRef.current) return;
		const audio = new Audio(ASSETS.sfx[name]);
		audio.volume = SFX_VOLUME;
		// 自動再生の制限などで失敗しても、遊びを止めない。
		void audio.play().catch(() => {});
	}, []);
}
