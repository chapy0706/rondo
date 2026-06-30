/**
 * ゲームの基底と、ソロ / リアルタイムの2層（ADR 0004）。
 *
 * SoloGame はブラウザ内で完結し、リアルタイム接続を一切受け取らない。
 * RealtimeGame だけが RealTimePort を受け取る。通信の都合をソロゲームに
 * 漏らさないために、接続の有無を型で分ける。
 */

import type { GameManifest } from "./manifest";
import type { ClientMessage, ServerMessage } from "./messages";

/**
 * リアルタイムゲームが基盤と通信するためのポート。
 *
 * 単一接続の多重化（ADR 0007）はクライアントの WebSocketAdapter が担い、
 * ゲームはこのポートを通じて型付きメッセージを送受信する。
 */
export interface RealTimePort {
	/** サーバーへメッセージを送る。 */
	send(message: ClientMessage): void;
	/** サーバーからのメッセージを購読する。購読解除の関数を返す。 */
	subscribe(handler: (message: ServerMessage) => void): () => void;
}

/** すべてのゲームに共通する基底。基盤はマニフェストだけを知る。 */
export interface Game {
	readonly manifest: GameManifest;
}

/**
 * ソロゲーム。ブラウザ内で完結する。
 *
 * RealTimePort を持たない。接続概念を一切受け取らないことが、この型の差である。
 */
export interface SoloGame extends Game {
	readonly kind: "solo";
}

/**
 * リアルタイムゲーム。複数人がルームに集まり、サーバーを介して同期する。
 *
 * connect で RealTimePort を受け取る点が SoloGame との差である。
 */
export interface RealtimeGame extends Game {
	readonly kind: "realtime";
	connect(port: RealTimePort): void;
}
