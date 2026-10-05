"use client";

/**
 * タブで共有するセッション（RealtimeSession）を、画面から使うための入口（issue-40）。
 *
 * セッションは、最初に使われたときに1つだけ作り、画面（ロビー・ゲーム画面）の
 * 切り替えをまたいで保つ。接続はタブを閉じるかリロードするまで開いたままにする。
 */

import { useSyncExternalStore } from "react";
import { createRealtimeConnection } from "../../infrastructure/realtime";
import { RealtimeSession } from "./RealtimeSession";
import { INITIAL_SESSION, type SessionState } from "./session";

let shared: RealtimeSession | null = null;

/** タブで共有するセッション。ブラウザの中でだけ呼ぶ（effect やイベントの中）。 */
export function getRealtimeSession(): RealtimeSession {
	if (shared === null) {
		const { adapter, resumeGameType } = createRealtimeConnection();
		shared = new RealtimeSession(adapter, { resumeGameType });
	}
	return shared;
}

const subscribe = (listener: () => void) =>
	getRealtimeSession().subscribeState(listener);
const getSnapshot = () => getRealtimeSession().state;
// サーバー側の描画では接続を作らない。
const getServerSnapshot = () => INITIAL_SESSION;

/** セッションの状態。変わったら描き直す。 */
export function useSessionState(): SessionState {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
