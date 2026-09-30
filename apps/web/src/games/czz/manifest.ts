import type { GameManifest } from "@rondo/contracts";

/**
 * czz の自己記述（ADR 0003）。
 *
 * 命令を並べて数の列を加工する、Linux コマンド学習のソロゲーム（ADR 0004）。
 * 基盤はこのマニフェストだけを読んで選択画面に並べる。追加時に基盤側のコードは変えない。
 */
export const czzManifest: GameManifest = {
	id: "czz",
	title: "czz",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	thumbnail: "/games/czz.png",
	description: "命令を並べて数の列を加工し、お題の出力を作るパズル。",
	// 起動画面は czz 自身が持つ（issue-21）。それまでは選択後すぐ本編に入る。
	launchScreen: "custom",
};
