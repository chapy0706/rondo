import type { GameManifest, RealtimeResult } from "@rondo/contracts";
import { showsResultInsteadOfGame } from "../../games/registry";

/**
 * リアルタイムの結果（game-ended）を、ゲームホストがどう出すか（issue-42）。
 * - none: 出さない（結果がまだ無い。ソロは reportResult の流れのままで、ここを通らない）
 * - instead-of-game: ゲームの代わりに結果画面を出す（registry で選んだゲームだけ）
 * - below-game: これまでどおり、ゲームの下に並べる
 */
export type ResultView = "none" | "instead-of-game" | "below-game";

export function resultView(
	manifest: GameManifest,
	result: RealtimeResult | null,
): ResultView {
	if (manifest.kind !== "realtime" || result === null) return "none";
	return showsResultInsteadOfGame(manifest.id)
		? "instead-of-game"
		: "below-game";
}
