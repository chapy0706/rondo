import type { GameManifest, PlayResult } from "@rondo/contracts";
import { useCallback } from "react";
import { useGameHost } from "./host";

/** ソロゲーム用フックが返す API。 */
export interface SoloGameApi {
	/** ゲームの結果を基盤に返す。 */
	reportResult: (result: PlayResult) => void;
}

/**
 * ソロゲーム用フック。
 *
 * 結果を基盤に返すだけで、RealTimePort を受け取らない（ADR 0004）。通信の都合を
 * ソロゲームに漏らさない。
 */
export function useSoloGame(_manifest: GameManifest): SoloGameApi {
	const host = useGameHost();
	const reportResult = useCallback(
		(result: PlayResult) => host.reportResult(result),
		[host],
	);
	return { reportResult };
}
