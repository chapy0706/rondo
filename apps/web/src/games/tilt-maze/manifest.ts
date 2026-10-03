import type { GameManifest } from "@rondo/contracts";
import { TEXT } from "./text";

/**
 * rolling の自己記述（ADR 0003）。内部の id は tilt-maze のまま（issue-36）。
 *
 * リアルタイムゲームなので kind は "realtime"、複数人でルームに集まって競う
 * （ADR 0004）。物理はクライアントで回すが、順位はサーバー受信順で確定する
 * （ADR 0014）。基盤はこのマニフェストだけを読んで選択画面に並べる。
 * 画面に出す名前・説明・遊び方は text.ts から取る。
 */
export const tiltMazeManifest: GameManifest = {
	id: "tilt-maze",
	title: TEXT.name,
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 4,
	thumbnail: "/games/tilt-maze.png",
	description: TEXT.description,
	launchScreen: "shared",
	tagline: TEXT.tagline,
	howToPlay: TEXT.howToPlay,
};
