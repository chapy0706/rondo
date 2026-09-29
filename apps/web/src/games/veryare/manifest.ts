import type { GameManifest } from "@rondo/contracts";

/**
 * veryare の自己記述（ADR 0003 / 0023）。
 *
 * 鬼1人と隠れ側最大4人のリアルタイムゲーム（ADR 0030）。フェーズと勝敗はサーバー権威
 * （server/src/rondo_server/games/veryare/）が決める。探索時間はルーム作成時に選び、
 * ルーム一覧には出さない（ADR 0024）。
 */
export const veryareManifest: GameManifest = {
	id: "veryare",
	title: "veryare",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 5,
	thumbnail: "/games/veryare.png",
	description: "見た目を塗って景色に溶け込む、鬼1人のかくれんぼ。",
	roomOptions: [
		{
			key: "explorationSeconds",
			label: "探索時間",
			choices: [40, 60, 80, 100, 120],
			default: 40,
		},
	],
};
