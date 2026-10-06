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
	/**
	 * つなぎ直しをすべて失敗し、あきらめたときに呼ばれる（issue-47）。購読解除の関数を返す。
	 * モックは失敗しないので呼ばない。
	 */
	onConnectionFailed(listener: () => void): () => void;
	/** あきらめた接続を、新しくつなぎ直す。つながっている間は何もしない。 */
	reconnect(): void;
}
