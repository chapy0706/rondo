"use client";

/**
 * 音の入口の部品（issue-63）。layout に 1 つだけ置く（ページを移っても残るので、BGM が途切れない）。
 *
 * - 画面を移るたびに、旗（SOUND_READY・?sound=1）と、いまのパスを soundHub に渡す
 * - 最初の操作（pointerdown・touchend・keydown）で、音の準備（AudioContext の再開）をする
 * - 画面が見えなくなったら止め、戻ったら再開する
 *
 * React のエラー境界で隔離する。音の部品の失敗は、ゲームの画面を壊さない（何も描かないで終わる）。
 */

import { usePathname } from "next/navigation";
import { Component, type ReactNode, useEffect } from "react";
import { SOUND_READY, resolveSoundFlag } from "./flag";
import { soundHub } from "./hub";
import { soundStorage } from "./settings";

const GESTURES = ["pointerdown", "touchend", "keydown"] as const;

class SoundBoundary extends Component<
	{ readonly children: ReactNode },
	{ readonly failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	override componentDidCatch(error: unknown): void {
		console.info(`[sound] 音の部品を止めた: ${String(error)}`);
	}

	override render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

function SoundRootInner(): null {
	const path = usePathname();

	useEffect(() => {
		try {
			const search = window.location.search;
			soundHub.configure(
				resolveSoundFlag(SOUND_READY, soundStorage(), search),
				path ?? window.location.pathname,
			);
		} catch (error) {
			console.info(`[sound] ${String(error)}（無音で続けます）`);
		}
	}, [path]);

	useEffect(() => {
		const unlock = () => soundHub.unlock();
		const onVisibility = () =>
			soundHub.setHidden(document.visibilityState === "hidden");
		for (const name of GESTURES) {
			window.addEventListener(name, unlock, { capture: true, passive: true });
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			for (const name of GESTURES) {
				window.removeEventListener(name, unlock, { capture: true });
			}
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	return null;
}

export function SoundRoot(): ReactNode {
	return (
		<SoundBoundary>
			<SoundRootInner />
		</SoundBoundary>
	);
}
