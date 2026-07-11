/**
 * Gleam サーバーへの単一 WebSocket 接続を多重化するアダプタ（ADR 0007）。
 *
 * 1 本の接続でロビー・ルーム・ゲーム進行のすべてを運ぶ。送信は JSON テキストで
 * 直列化し、接続確立前の送信は outbox に貯めて open で流す。受信は境界で検証して
 * から購読者へ配り、型の嘘を通さない（ADR 0009）。
 */

import type { ClientMessage } from "@rondo/contracts";
import { MultiplexingAdapter } from "./MultiplexingAdapter";
import { parseServerMessage, safeJsonParse } from "./parse";

export class WebSocketAdapter extends MultiplexingAdapter {
	private readonly socket: WebSocket;
	private readonly outbox: ClientMessage[] = [];
	private connected = false;

	constructor(url: string) {
		super();
		this.socket = new WebSocket(url);
		this.socket.addEventListener("open", () => {
			this.connected = true;
			this.flush();
		});
		this.socket.addEventListener("message", (event) => {
			this.receive(event.data);
		});
		this.socket.addEventListener("close", () => {
			this.connected = false;
		});
	}

	send(message: ClientMessage): void {
		if (this.connected) {
			this.socket.send(JSON.stringify(message));
		} else {
			this.outbox.push(message);
		}
	}

	close(): void {
		this.socket.close();
	}

	private flush(): void {
		for (const message of this.outbox.splice(0)) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private receive(data: unknown): void {
		// rondo はテキストフレームで多重化する。バイナリは想定しないため捨てる。
		if (typeof data !== "string") return;
		const parsed = parseServerMessage(safeJsonParse(data));
		if (parsed !== null) this.dispatch(parsed);
	}
}
