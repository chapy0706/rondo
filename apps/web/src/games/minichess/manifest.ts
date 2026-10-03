import type { GameManifest } from "@rondo/contracts";

/**
 * chess（内部名 minichess / 5×5 チェス）の自己記述（ADR 0003 / issue-38）。
 *
 * サーバーを使わない1人用ゲーム（ADR 0004）。相手は CPU。起動画面は基盤共通のもの（issue-30）。
 */
export const minichessManifest: GameManifest = {
	id: "minichess",
	title: "chess",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	thumbnail: "/games/minichess.png",
	description: "5×5 の小さな盤で、CPU とチェスを指す。",
	launchScreen: "shared",
	tagline: "小さな盤で、王を詰ませろ。",
	howToPlay: [
		"あなたは白番。駒をタップして、光ったマスをタップすると指せる",
		"ポーンは1マスずつ進み、奥まで着くとクイーンになる",
		"黒のキングを詰ませたら勝ち。迷ったら「お助け」で次の一手が見える",
	],
};
