import type { GameManifest } from "@rondo/contracts";

/**
 * link（内部名 nikaku-keshi / 二角消去）の自己記述（ADR 0003 / issue-37）。
 *
 * サーバーを使わない1人用ゲーム（ADR 0004）。起動画面は基盤共通のもの（issue-30）。
 */
export const nikakuKeshiManifest: GameManifest = {
	id: "nikaku-keshi",
	title: "二角消去",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	description: "同じ牌を、2回までの折れ線でつなごう",
	// ロゴ（issue-69）。画像は後半で足す。いまは背景の色と頭文字の仮のタイル。
	logo: { background: "#c8553d" },
	launchScreen: "shared",
	tagline: "つないで、消して、空にする。",
	howToPlay: [
		"同じ牌を2枚タップすると、つなげれば消える",
		"線は2回まで曲げられる。牌の上は通れない（盤の外側は通れる）",
		"全部消したらクリア。困ったら「お助け」",
	],
};
