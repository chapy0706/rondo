/**
 * 音の入口を、画面から使うフック（issue-63）。旗が無い間は、soundHub が何もしない。
 */

import { useEffect, useSyncExternalStore } from "react";
import { type SoundSnapshot, soundHub } from "./hub";

/** 結果画面を出しているか（PlayHost が知らせる。結果画面は無音）。 */
export function useSoundResult(shown: boolean): void {
	useEffect(() => {
		soundHub.setResult(shown);
	}, [shown]);
	useEffect(() => () => soundHub.setResult(false), []);
}

/** 旗と設定（設定の画面が読む）。 */
export function useSoundSnapshot(): SoundSnapshot {
	return useSyncExternalStore(
		soundHub.subscribe,
		soundHub.snapshot,
		soundHub.snapshot,
	);
}
