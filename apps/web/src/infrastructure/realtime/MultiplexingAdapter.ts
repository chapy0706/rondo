/**
 * 多重化アダプタの共通土台。
 *
 * 単一接続の多重化（ADR 0007）の受信側は「1 本の入力を、関心を持つ各機能へ配る」
 * ことに尽きる。購読者の管理とファンアウトをここに集約し、実接続（WebSocket）と
 * Mock は送信と受信元だけを与える。各購読者は受け取った ServerMessage を type /
 * gameType / roomId で自分宛かどうか判定する（例: SDK の readGameState）。
 */

import type { ClientMessage, ServerMessage } from "@rondo/contracts";
import type { RealtimeAdapter } from "./port";

export abstract class MultiplexingAdapter implements RealtimeAdapter {
	private readonly subscribers = new Set<(message: ServerMessage) => void>();

	/** サーバーへ送る。実装は接続先に応じて与える。 */
	abstract send(message: ClientMessage): void;

	/** 接続を閉じる。実装は接続先に応じて与える。 */
	abstract close(): void;

	subscribe(handler: (message: ServerMessage) => void): () => void {
		this.subscribers.add(handler);
		return () => {
			this.subscribers.delete(handler);
		};
	}

	/**
	 * 受信した 1 通を全購読者へ配る。購読解除が反復中に起きても壊れないよう、
	 * スナップショットを取ってから回す。
	 */
	protected dispatch(message: ServerMessage): void {
		for (const handler of [...this.subscribers]) {
			handler(message);
		}
	}
}
