import type { GameManifest } from "@rondo/contracts";

/**
 * 共通起動画面を挟むか（issue-30）。基盤はマニフェストの宣言を見て振り分けるだけで、
 * 個々のゲームの起動画面の中身を知らない（ADR 0003）。custom のゲームは自分で持つ。
 */
export function needsLaunchScreen(manifest: GameManifest): boolean {
	return manifest.launchScreen === "shared";
}
