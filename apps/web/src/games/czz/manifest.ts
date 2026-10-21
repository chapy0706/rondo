import type { GameManifest } from "@rondo/contracts";

/**
 * czz の自己記述（ADR 0003）。
 *
 * 命令を並べて数の列を加工する、Linux コマンド学習のソロゲーム（ADR 0004）。
 * 基盤はこのマニフェストだけを読んで選択画面に並べる。追加時に基盤側のコードは変えない。
 */
export const czzManifest: GameManifest = {
	id: "czz",
	title: "指示厨ゲーム",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	description: "指示のとおりに、コマンドを並べよう",
	// ロゴ（issue-69）。画像が読めないときは、背景の色と頭文字の仮のタイル。
	logo: { src: "/games/czz/logo.webp", background: "#ffe3dc" },
	// 起動画面は czz 自身が持つ（issue-21）。それまでは選択後すぐ本編に入る。
	launchScreen: "custom",
};
