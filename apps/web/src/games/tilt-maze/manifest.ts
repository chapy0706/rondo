import type { GameManifest } from "@rondo/contracts";

/**
 * Tilt Maze の自己記述（ADR 0003）。
 *
 * リアルタイムゲームなので kind は "realtime"、複数人でルームに集まって競う
 * （ADR 0004）。物理はクライアントで回すが、順位はサーバー受信順で確定する
 * （ADR 0014）。基盤はこのマニフェストだけを読んで選択画面に並べる。
 */
export const tiltMazeManifest: GameManifest = {
	id: "tilt-maze",
	title: "Tilt Maze",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 4,
	thumbnail: "/games/tilt-maze.png",
	description: "パッドで球を転がし、迷路を抜けて最速の10面クリアを目指す。",
};
