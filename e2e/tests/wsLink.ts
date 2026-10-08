/**
 * タブごとの WebSocket の経路（issue-48）。Playwright の routeWebSocket で、ページと
 * Gleam サーバーの間に入る。
 *
 * - 観察: 行き来した電文を、時刻つきで記録する（ハートビートの確認、ルーム ID の取得）
 * - 注入: このタブの接続から、サーバーへ電文を送る（鬼希望エリアの中央へ動いた、など）。
 *   veryare の移動は画面のジョイスティック（タッチ）なので、テストではサーバーへの電文で
 *   代える。ゲームの判定は、サーバーがいつもどおり行う
 * - 通信の遮断（offline）: サーバー側の接続を切り、ページ側は開いたまま黙らせる（応答の
 *   ない回線と同じ見え方）。遮断中に開いた接続も、サーバーへつながず黙らせる
 * - 通信の回復（online）: 黙らせていたページ側の接続を閉じる。ページはつなぎ直し、新しい
 *   接続はサーバーへつながる
 */

import type { Page, WebSocketRoute } from "@playwright/test";

/** 記録した電文。sent はページ → サーバー、received はサーバー → ページ。 */
export interface Frame {
	readonly direction: "sent" | "received";
	readonly at: number;
	readonly message: Record<string, unknown>;
}

interface Pair {
	readonly page: WebSocketRoute;
	server: WebSocketRoute | null;
	/** 遮断で切った（サーバー側の close をページへ伝えない）。 */
	cut: boolean;
}

export class WsLink {
	readonly frames: Frame[] = [];
	private online = true;
	private readonly pairs = new Set<Pair>();

	static async attach(page: Page): Promise<WsLink> {
		const link = new WsLink();
		await page.routeWebSocket(/\/ws$/, (ws) => link.accept(ws));
		return link;
	}

	/** 通信を遮断する。今の接続のサーバー側を切り、ページ側は黙らせる。 */
	async goOffline(): Promise<void> {
		this.online = false;
		for (const pair of this.pairs) {
			pair.cut = true;
			const server = pair.server;
			pair.server = null;
			await server?.close();
		}
	}

	/** 通信を戻す。黙らせていたページ側の接続を閉じ、つなぎ直させる。 */
	async goOnline(): Promise<void> {
		this.online = true;
		for (const pair of [...this.pairs]) {
			if (pair.server === null) {
				this.pairs.delete(pair);
				await pair.page.close();
			}
		}
	}

	/** このタブの接続から、サーバーへ電文を送る。 */
	inject(message: Record<string, unknown>): void {
		const pair = [...this.pairs].find((p) => p.server !== null);
		if (pair?.server == null) throw new Error("サーバーにつながっていない");
		this.record("sent", message);
		pair.server.send(JSON.stringify(message));
	}

	/** サーバーにつながっている接続があるか。 */
	connected(): boolean {
		return [...this.pairs].some((p) => p.server !== null);
	}

	/** 受け取った電文のうち、type が一致するもの。 */
	received(type: string): Frame[] {
		return this.frames.filter(
			(f) => f.direction === "received" && f.message.type === type,
		);
	}

	sent(type: string): Frame[] {
		return this.frames.filter(
			(f) => f.direction === "sent" && f.message.type === type,
		);
	}

	/** 最後に入ったルームの ID（room-joined）。 */
	roomId(): string | null {
		const joined = this.received("room-joined").at(-1);
		const id = joined?.message.roomId;
		return typeof id === "string" ? id : null;
	}

	private accept(page: WebSocketRoute): void {
		const pair: Pair = { page, server: null, cut: !this.online };
		this.pairs.add(pair);
		if (!this.online) {
			// 遮断中: サーバーへつながず、ページの電文は捨てる（応答のない回線）。
			page.onMessage(() => {});
			return;
		}
		const server = page.connectToServer();
		pair.server = server;
		page.onMessage((data) => {
			this.record("sent", parse(data));
			if (pair.server !== null) pair.server.send(data);
		});
		server.onMessage((data) => {
			this.record("received", parse(data));
			page.send(data);
		});
		page.onClose(() => {
			this.pairs.delete(pair);
			void pair.server?.close();
		});
		server.onClose(() => {
			// 遮断で切ったときは、ページへ伝えない（ページ側は黙ったまま）。
			if (pair.cut) return;
			this.pairs.delete(pair);
			void page.close();
		});
	}

	private record(
		direction: Frame["direction"],
		message: Record<string, unknown>,
	) {
		this.frames.push({ direction, at: Date.now(), message });
	}
}

function parse(data: string | Buffer): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(data.toString());
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
