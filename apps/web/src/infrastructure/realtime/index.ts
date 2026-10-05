/**
 * リアルタイム接続アダプタの入口。
 *
 * 既定はモック（サーバーなしで開発できる状態を初期値にする）。環境変数
 * NEXT_PUBLIC_RONDO_WS_URL が設定されていれば実接続に切り替える。値の直書きは
 * せず、接続先は設定として外から与える。
 */

import type { GameType } from "@rondo/contracts";
import { MockWebSocketAdapter } from "./MockWebSocketAdapter";
import { WebSocketAdapter } from "./WebSocketAdapter";
import type { RealtimeAdapter } from "./port";
import { browserResumeStore } from "./resumeStore";

export type { RealtimeAdapter } from "./port";
export { MockWebSocketAdapter } from "./MockWebSocketAdapter";
export { WebSocketAdapter } from "./WebSocketAdapter";

/** 作った接続と、リロード前のルームへ復帰を頼んでいるならそのゲームの種類。 */
export interface RealtimeConnection {
	readonly adapter: RealtimeAdapter;
	readonly resumeGameType: GameType | null;
}

/**
 * タブで共有する接続を 1 つ作る（issue-40）。実接続では、リロードをまたいで復帰先を
 * 覚える。モックはブラウザの中だけのルームなので、リロードすると戻る先がなく、覚えない。
 */
export function createRealtimeConnection(): RealtimeConnection {
	const url = process.env.NEXT_PUBLIC_RONDO_WS_URL;
	if (!url) {
		return { adapter: new MockWebSocketAdapter(), resumeGameType: null };
	}
	const resumeStore = browserResumeStore();
	const resumeGameType = resumeStore.load()?.gameType ?? null;
	return {
		adapter: new WebSocketAdapter(url, { resumeStore }),
		resumeGameType,
	};
}
