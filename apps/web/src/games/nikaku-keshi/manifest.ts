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
	// ロゴ（issue-69）。画像が読めないときは、背景の色と頭文字の仮のタイル。
	logo: { src: "/games/nikaku-keshi/logo.webp", background: "#c8553d" },
	launchScreen: "shared",
	tagline: "つないで、消して、空にする。",
	howToPlay: [
		"同じ牌を2枚タップすると、つなげれば消える",
		"線は2回まで曲げられる。牌の上は通れない（盤の外側は通れる）",
		"全部消したらクリア。困ったら「お助け」",
	],
};

/**
 * ゲーム画面を、画面いっぱいの 1 枚にするか（上部バーと、盤と操作部品。iPhone の縦画面で、スクロール
 * なしで収める）。共通の入れ物（platform/host/PlayHost.tsx）が、games/registry の isFullscreenGame を
 * 通して読む。契約の型（GameManifest）には足さない。
 */
export const NIKAKU_KESHI_FULLSCREEN = true;
