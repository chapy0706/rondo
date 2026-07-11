import type { GameManifest } from "@rondo/contracts";

/**
 * テトリスの自己記述（ADR 0003）。
 *
 * 基盤はこのマニフェストだけを読んで選択画面に並べる。ソロゲームなので
 * kind は "solo"、人数は 1（ADR 0004）。追加時に基盤側のコードは変えない。
 */
export const tetrisManifest: GameManifest = {
	id: "tetris",
	title: "テトリス",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	thumbnail: "/games/tetris.png",
	description: "落ちてくるブロックを積んで、揃った行を消す定番パズル。",
};
