import type { GameManifest } from "@rondo/contracts";

/**
 * テ〇〇ス（落ちものパズル。内部の id は tetris）の自己記述（ADR 0003）。
 *
 * 基盤はこのマニフェストだけを読んで選択画面に並べる。ソロゲームなので
 * kind は "solo"、人数は 1（ADR 0004）。追加時に基盤側のコードは変えない。
 */
export const tetrisManifest: GameManifest = {
	id: "tetris",
	title: "テ〇〇ス",
	// 表示名は読み上げに向かない（〇は漢数字のゼロ U+3007）ので、読み上げと代替の文字は別に持つ。
	spokenTitle: "落ちものパズル",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	description: "落ちてくるブロックを、そろえて消そう",
	// ロゴ（issue-69）。画像が読めないときは、背景の色と頭文字の仮のタイル。
	logo: { src: "/games/tetris/logo.svg", background: "#5b3f8f" },
	launchScreen: "shared",
	tagline: "積んで、揃えて、消す。",
	howToPlay: [
		"パッドの左右でブロックを動かす",
		"パッドの上で回転、下で速く落とす",
		"横一列が揃うと消えて得点になる",
	],
};

/**
 * ゲーム画面を、画面いっぱいの 1 枚にするか（上部バーと、盤と操作部品。iPhone の縦画面で、スクロール
 * なしで収める）。共通の入れ物（platform/host/PlayHost.tsx）が、games/registry の isFullscreenGame を
 * 通して読む。契約の型（GameManifest）には足さない。
 */
export const TETRIS_FULLSCREEN = true;
