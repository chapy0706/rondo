/**
 * 基盤内部で扱うリアルタイム接続の口。
 *
 * ゲームに渡すのは契約の RealTimePort（send / subscribe）だが、基盤側は
 * 接続の後始末のために close も要る。RealtimeAdapter は RealTimePort に
 * ライフサイクルを足しただけの、基盤内向けの拡張である。
 */

import type { RealTimePort } from "@rondo/contracts";

export interface RealtimeAdapter extends RealTimePort {
	/** 接続を閉じ、購読を解く。 */
	close(): void;
}
