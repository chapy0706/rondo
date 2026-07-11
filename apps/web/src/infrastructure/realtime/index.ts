/**
 * リアルタイム接続アダプタの入口。
 *
 * 既定はモック（サーバーなしで開発できる状態を初期値にする）。環境変数
 * NEXT_PUBLIC_RONDO_WS_URL が設定されていれば実接続に切り替える。値の直書きは
 * せず、接続先は設定として外から与える。
 */

import { MockWebSocketAdapter } from "./MockWebSocketAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";
import type { RealtimeAdapter } from "./port";

export type { RealtimeAdapter } from "./port";
export { MockWebSocketAdapter } from "./MockWebSocketAdapter";
export { WebSocketAdapter } from "./WebSocketAdapter";

/** ロビーで使うアダプタを 1 つ作る。既定はモック。 */
export function createLobbyAdapter(): RealtimeAdapter {
	const url = process.env.NEXT_PUBLIC_RONDO_WS_URL;
	return url ? new WebSocketAdapter(url) : new MockWebSocketAdapter();
}
