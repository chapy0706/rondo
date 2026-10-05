/**
 * リロードをまたいでルームへ戻るための、復帰先の置き場（issue-40 / ADR 0013）。
 *
 * WebSocketAdapter は、切断しても同じ接続の中ではルームと復帰トークンを覚えているが、
 * リロードするとそれが消える。そこで、参加中のルームと復帰トークンを、タブごとの
 * sessionStorage に置く。sessionStorage はタブを閉じれば消え、ほかのタブとは共有しない
 * （タブごとに別のプレイヤーとして遊ぶため）。復帰トークンは本人の秘密の値なので、
 * この置き場から読むのは WebSocketAdapter だけとし、画面やログには出さない。
 *
 * 置き場から読む値は、利用者や拡張機能が書き換えられるので、境界として形を検証する。
 * ストレージが使えない環境（プライベートブラウズの制限など）では、何も覚えずに動く。
 */

import type { GameType, RoomId } from "@rondo/contracts";

/** 復帰先。 */
export interface ResumeTarget {
	readonly gameType: GameType;
	readonly roomId: RoomId;
	readonly resumeToken: string;
}

export interface ResumeStore {
	load(): ResumeTarget | null;
	save(target: ResumeTarget): void;
	clear(): void;
}

/** 使うストレージの最小形（ブラウザの Storage と、テスト用の偽物）。 */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const KEY = "rondo.resume";

function toResumeTarget(value: unknown): ResumeTarget | null {
	if (typeof value !== "object" || value === null) return null;
	const { gameType, roomId, resumeToken } = value as Record<string, unknown>;
	if (
		typeof gameType !== "string" ||
		typeof roomId !== "string" ||
		typeof resumeToken !== "string"
	) {
		return null;
	}
	return { gameType, roomId, resumeToken };
}

export function createResumeStore(storage: StorageLike | null): ResumeStore {
	return {
		load() {
			if (storage === null) return null;
			try {
				const raw = storage.getItem(KEY);
				return raw === null ? null : toResumeTarget(JSON.parse(raw));
			} catch {
				return null;
			}
		},
		save(target) {
			try {
				storage?.setItem(KEY, JSON.stringify(target));
			} catch {
				// 覚えられなくても、リロードでの復帰ができないだけで、遊ぶことはできる。
			}
		},
		clear() {
			try {
				storage?.removeItem(KEY);
			} catch {
				// 同上。
			}
		},
	};
}

/** ブラウザのタブごとの置き場。使えなければ、何も覚えない置き場になる。 */
export function browserResumeStore(): ResumeStore {
	let storage: StorageLike | null = null;
	try {
		storage = typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		storage = null;
	}
	return createResumeStore(storage);
}
