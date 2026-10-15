import type { GameManifest } from "@rondo/contracts";
import { TEXT } from "./text";

/**
 * ころころ迷路の自己記述（ADR 0003）。内部の id は tilt-maze のまま（issue-36）。表示名と説明文は
 * ここだけに持つ（issue-69）。
 *
 * リアルタイムゲームなので kind は "realtime"、複数人でルームに集まって競う
 * （ADR 0004）。物理はクライアントで回すが、順位はサーバー受信順で確定する
 * （ADR 0014）。基盤はこのマニフェストだけを読んで選択画面に並べる。
 * 画面に出す名前・説明・遊び方は text.ts から取る。
 */
export const tiltMazeManifest: GameManifest = {
	id: "tilt-maze",
	title: "ころころ迷路",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 4,
	description: "傾けて、球をゴールへ転がそう",
	// ロゴ（issue-69）。画像が読めないときは、背景の色と頭文字の仮のタイル。
	logo: { src: "/games/tilt-maze/logo.svg", background: "#3f8f5a" },
	launchScreen: "shared",
	tagline: TEXT.tagline,
	howToPlay: TEXT.howToPlay,
};
