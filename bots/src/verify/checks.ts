/**
 * デプロイ後の自動確認（issue-50）の、実際の確認（HTTP・WebSocket）。判定は judge.ts、
 * 集計・再試行・終了コードは report.ts（どちらも純粋関数で、テスト済み）。入口は verify.ts。
 *
 * - 利用者に影響しない操作だけにする（作ったルームは、必ず退出する）
 * - 秘密の値（env の中身）は出力に出さない。URL と応答のヘッダだけ出す
 * - 各確認は Attempt（ok と detail）を返す。verify.ts が再試行して CheckResult にする
 *
 * 副作用: 公開 URL への HTTP の GET と、WebSocket の接続（ルームの作成と退出を含む）。
 */

import { Bot } from "../client.ts";
import {
	judgeGlb,
	judgeManifest,
	judgeWeb,
	smallestAssetPath,
} from "./judge.ts";
import { type Attempt, withRetry } from "./report.ts";

const GAME_TYPE = "veryare";
const CONNECT_TIMEOUT_MS = 10_000;
const REPLY_TIMEOUT_MS = 10_000;
const createSocket = (url: string) => new WebSocket(url);

/** 公開 URL の設定。 */
export interface Targets {
	/** web の公開 URL（例: https://rondo.chapy0706.com）。 */
	readonly webUrl: string;
	/** web の <title> に入っているはずの文字列。 */
	readonly webTitle: string;
	/** WebSocket の URL（例: wss://ws-rondo.chapy0706.com/ws）。 */
	readonly wsUrl: string;
	/** 素材の公開 URL（未設定なら素材の確認は省く）。 */
	readonly assetBaseUrl: string | undefined;
	/** 素材が CORS で許可するオリジン（既定は webUrl のオリジン）。 */
	readonly assetOrigin: string;
	/** ping を待つ時間（ミリ秒）。 */
	readonly pingTimeoutMs: number;
}

/** web が 200 で HTML を返し、タイトルが合う。 */
export function webCheck(targets: Targets): () => Promise<Attempt> {
	return async () => {
		try {
			const response = await fetch(targets.webUrl, { redirect: "follow" });
			const body = await response.text();
			return judgeWeb(
				response.status,
				response.headers.get("content-type") ?? "",
				body,
				targets.webTitle,
			);
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		}
	};
}

/** WebSocket につながり、session（プレイヤー識別子）が届く。 */
export function wsCheck(targets: Targets): () => Promise<Attempt> {
	return async () => {
		let bot: Bot | null = null;
		try {
			bot = await connect(targets, "verify-ws");
			return bot.playerId === null
				? { ok: false, detail: "session にプレイヤー識別子が無い" }
				: { ok: true, detail: "session を受け取った" };
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		} finally {
			bot?.close();
		}
	};
}

/**
 * ルームを作り、必ず退出し、一覧に残らないことを確かめる。
 * 退出はサーバーの中で非同期に処理されるので、一覧は、残らなくなるまで数回取り直す。
 */
export function roomCheck(targets: Targets): () => Promise<Attempt> {
	return async () => {
		let creator: Bot | null = null;
		let watcher: Bot | null = null;
		try {
			creator = await connect(targets, "verify-room");
			creator.send({ type: "create-room", gameType: GAME_TYPE });
			const joined = await creator.waitFor(
				(m) => m.type === "room-joined",
				REPLY_TIMEOUT_MS,
				"room-joined",
			);
			if (joined.type !== "room-joined")
				return { ok: false, detail: "room-joined の形が違う" };
			const roomId = joined.roomId;
			// 必ず退出する（台帳に残さない）。退出を送ってから閉じる（順に届く）。
			creator.send({ type: "leave-room", roomId });
			creator.close();
			creator = null;

			// 別の接続で一覧を取り、作ったルームが残っていないことを確かめる。
			watcher = await connect(targets, "verify-list");
			const listener = watcher;
			const gone = await withRetry(
				async () => {
					const before = listener.all("room-list").length;
					listener.send({ type: "list-rooms", gameType: GAME_TYPE });
					// 送った後に届いた room-list だけを見る（前の一覧を読まない）。
					await listener.waitFor(
						() => listener.all("room-list").length > before,
						REPLY_TIMEOUT_MS,
						"room-list",
					);
					const latest = listener.all("room-list").at(-1);
					const remains =
						latest?.rooms.some((room) => room.roomId === roomId) ?? true;
					return { ok: !remains, detail: "" };
				},
				{ retries: 5, intervalMs: 1_000, sleep },
			);
			return gone.ok
				? { ok: true, detail: `作成と退出ができ、一覧に残らない（${roomId}）` }
				: {
						ok: false,
						detail: `退出したルーム ${roomId} が一覧に残っている（${gone.attempts}回確かめた）`,
					};
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		} finally {
			creator?.close();
			watcher?.close();
		}
	};
}

/** ping が、指定の時間のうちに届く（接続の層のハートビート / issue-41）。 */
export function pingCheck(targets: Targets): () => Promise<Attempt> {
	return async () => {
		let bot: Bot | null = null;
		try {
			bot = await connect(targets, "verify-ping");
			const started = Date.now();
			await bot.waitFor(
				(m) => m.type === "ping",
				targets.pingTimeoutMs,
				"ping",
			);
			return {
				ok: true,
				detail: `ping が届いた（接続から約 ${Math.round((Date.now() - started) / 1000)} 秒）`,
			};
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		} finally {
			bot?.close();
		}
	};
}

/** 素材の manifest.json: 200・CORS・キャッシュ（max-age=60）。 */
export function assetManifestCheck(
	targets: Targets,
	base: string,
): () => Promise<Attempt> {
	return async () => {
		try {
			const response = await fetch(`${base}/manifest.json`, {
				headers: { Origin: targets.assetOrigin },
			});
			await response.body?.cancel();
			return judgeManifest(
				response.status,
				response.headers.get("access-control-allow-origin") ?? "",
				response.headers.get("cache-control") ?? "",
				targets.assetOrigin,
			);
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		}
	};
}

/**
 * 素材の glb: 200・型・immutable。同じ URL を2回取り、2回目で Cloudflare のキャッシュが
 * 効いている（cf-cache-status=HIT）ことを確かめる。対象は、manifest.json のいちばん小さい素材。
 */
export function assetGlbCheck(
	base: string,
	path: string,
): () => Promise<Attempt> {
	return async () => {
		const url = `${base}/${path}`;
		try {
			const first = await fetch(url);
			// 本文は読まずに捨てる（Cloudflare は、要求とは別にオリジンから取ってキャッシュする）。
			await first.body?.cancel();
			const second = await fetch(url);
			await second.body?.cancel();
			const result = judgeGlb(
				first.status,
				first.headers.get("content-type") ?? "",
				first.headers.get("cache-control") ?? "",
				second.headers.get("cf-cache-status"),
			);
			return { ...result, detail: `${path} ${result.detail}` };
		} catch (error) {
			return { ok: false, detail: errorText(error) };
		}
	};
}

/** manifest.json から、glb の確認に使う素材のパスを取る。取れなければ null。 */
export async function assetPathForCheck(base: string): Promise<string | null> {
	try {
		const response = await fetch(`${base}/manifest.json`);
		if (response.status !== 200) {
			await response.body?.cancel();
			return null;
		}
		const body: unknown = await response.json();
		return smallestAssetPath(body);
	} catch {
		return null;
	}
}

function connect(targets: Targets, name: string): Promise<Bot> {
	return Bot.connect(targets.wsUrl, name, createSocket, CONNECT_TIMEOUT_MS);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 例外の文言。fetch の失敗は「fetch failed」だけなので、原因（ECONNREFUSED など）を添える。 */
function errorText(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause =
		error.cause instanceof Error ? `（${error.cause.message}）` : "";
	return `${error.message}${cause}`;
}
