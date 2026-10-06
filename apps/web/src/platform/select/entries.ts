import type { GameManifest } from "@rondo/contracts";
import { isRealtimeMatch, lobbyPathOf, playPathOf } from "../../games/registry";

/** 選択画面の入口のボタン。 */
export interface Entry {
	readonly label: string;
	readonly href: string;
}

/**
 * 選択画面で、選んだゲームに出す入口（issue-47）。リアルタイム対戦のゲームだけ、
 * 「新しく遊ぶ」（ルームを作って入る）と「ルームに参加する」（ロビーへ）の2つを出す。
 * ほかのゲームは入口を分けず、従来どおりカードを押して始める（空の一覧）。
 */
export function entriesOf(manifest: GameManifest): readonly Entry[] {
	if (!isRealtimeMatch(manifest.id)) return [];
	return [
		{ label: "新しく遊ぶ", href: playPathOf(manifest.id) },
		{ label: "ルームに参加する", href: lobbyPathOf(manifest.id) },
	];
}
