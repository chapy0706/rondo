import type { GameManifest } from "@rondo/contracts";

/**
 * veryare の自己記述（ADR 0003 / 0023）。
 *
 * 鬼1人と隠れ側最大4人のリアルタイムゲーム（ADR 0030）。フェーズと勝敗はサーバー権威
 * （server/src/rondo_server/games/veryare/）が決める。探索時間はルーム作成時に選び、
 * ルーム一覧には出さない（ADR 0024）。CPU（ADR 0038）もルーム作成時に選び、
 * 接続を持たない参加者（CPU N）として加わる。
 */
export const veryareManifest: GameManifest = {
	id: "veryare",
	title: "veryare",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 5,
	thumbnail: "/games/veryare.png",
	description: "見た目を塗って景色に溶け込む、鬼1人のかくれんぼ。",
	// 起動画面（サーバーを探す / 作る）は veryare 自身が持つ（issue-29）。
	launchScreen: "custom",
	roomOptions: [
		{
			key: "explorationSeconds",
			label: "探索時間",
			choices: [40, 60, 80, 100, 120],
			default: 40,
		},
		{
			key: "cpu",
			label: "CPU",
			// 0 = なし、1〜3 = 隠れ側 CPU の数、4 = 鬼 CPU（サーバーの room.gleam と揃える）。
			choices: [0, 1, 2, 3, 4],
			default: 0,
			choiceLabels: {
				0: "なし",
				1: "隠れ側 CPU 1体",
				2: "隠れ側 CPU 2体",
				3: "隠れ側 CPU 3体",
				4: "鬼 CPU",
			},
		},
	],
};
