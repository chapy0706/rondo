/**
 * BGM の再生（本家 apps/user/src/lib/audio/BgmPlayer.ts から移したもの）。
 *
 * 本家はアプリ全体で1つのプレイヤーを持っていたが、rondo では czz の画面ごとに持ち、
 * 画面を離れたら stop で止める（他のゲームに BGM を持ち越さない）。自動再生が拒否された
 * ときは、最初のタップ・キー入力で再生し直す。
 */

import type { BgmTrack } from "../presentation";

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0.5;
	return Math.min(1, Math.max(0, value));
}

function safeRewind(audio: HTMLAudioElement): void {
	try {
		audio.currentTime = 0;
	} catch {
		// 読み込み前は失敗することがある。無視してよい。
	}
}

export class BgmPlayer {
	private audio: HTMLAudioElement | null = null;
	private currentSrc: string | null = null;
	private desired: BgmTrack | null = null;
	private unblockHandler: (() => void) | null = null;

	private ensureAudio(): HTMLAudioElement {
		if (this.audio !== null) return this.audio;
		const audio = new Audio();
		audio.preload = "auto";
		(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
		this.audio = audio;
		return audio;
	}

	/** 曲を切り替える。null なら止める。同じ曲なら頭出しせずに続ける。 */
	async setTrack(track: BgmTrack | null): Promise<void> {
		this.desired = track;
		if (track === null) {
			this.stop();
			return;
		}

		const audio = this.ensureAudio();
		audio.volume = clamp01(track.volume);
		audio.loop = track.loop;

		if (this.currentSrc !== track.src) {
			audio.pause();
			safeRewind(audio);
			audio.src = track.src;
			try {
				audio.load();
			} catch {
				// src 変更直後の load 失敗は再生時にもう一度試す。
			}
			this.currentSrc = track.src;
		}

		await this.tryPlay();
	}

	stop(): void {
		this.detachUnblock();
		this.desired = null;
		this.currentSrc = null;
		if (this.audio === null) return;
		this.audio.pause();
		safeRewind(this.audio);
	}

	private async tryPlay(): Promise<void> {
		const audio = this.audio;
		if (audio === null || this.desired === null) return;
		this.detachUnblock();
		try {
			await audio.play();
		} catch {
			// 自動再生の制限。最初の操作で再生し直す。
			this.attachUnblock();
		}
	}

	private attachUnblock(): void {
		if (this.unblockHandler !== null) return;
		const handler = () => {
			this.detachUnblock();
			void this.tryPlay();
		};
		this.unblockHandler = handler;
		window.addEventListener("pointerdown", handler, { once: true });
		window.addEventListener("keydown", handler, { once: true });
	}

	private detachUnblock(): void {
		const handler = this.unblockHandler;
		if (handler === null) return;
		this.unblockHandler = null;
		window.removeEventListener("pointerdown", handler);
		window.removeEventListener("keydown", handler);
	}
}
