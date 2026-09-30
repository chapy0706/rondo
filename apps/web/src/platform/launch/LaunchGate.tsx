import type { GameManifest } from "@rondo/contracts";
import type { ReactNode } from "react";
import { LaunchScreen } from "./LaunchScreen";

/**
 * 起動前なら共通起動画面を、起動後なら本編（children）を出す。
 *
 * 起動済みかどうかはゲームホストが持つ（初期値は needsLaunchScreen の否定）。ホストは
 * 起動した時点でルームへの接続などを始められる。custom のゲームは最初から起動済みとして
 * 渡され、共通起動画面を経由しない。
 */
export function LaunchGate({
	manifest,
	launched,
	onStart,
	children,
}: {
	manifest: GameManifest;
	launched: boolean;
	onStart: () => void;
	children: ReactNode;
}) {
	return launched ? (
		children
	) : (
		<LaunchScreen manifest={manifest} onStart={onStart} />
	);
}
