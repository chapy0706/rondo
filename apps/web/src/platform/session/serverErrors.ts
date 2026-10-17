/**
 * サーバーのエラーの種類（error の code）を、利用者向けの文言と、次の行動に直す（issue-60）。文言は
 * サーバーではなく、ここ1か所に持つ（サーバーの message は画面に出さない）。サーバーの種類と契約は
 * 変えない。知らない種類は、既定の文言に落とす。
 */

/** サーバーが返すエラーの種類の全部（server/src/rondo_server/connection/ / ADR 0047）。 */
export const SERVER_ERROR_CODES = [
	"room-limit",
	"room-full",
	"game-already-started",
	"room-not-found",
	"already-joined",
	"already-in-room",
	"reconnect-failed",
	"room-closed",
	"unknown-game",
	"invalid-settings",
	"server-error",
	"bad-message",
] as const;

/**
 * 次の行動（画面のボタン）。
 * - solo: ひとり用のゲームの一覧を出す
 * - refresh: 一覧を更新する
 * - reload: 画面を読み込み直す（前のルームに入ったままのとき。復帰のトークンで前のルームへ戻るか、新しい
 *   接続になる。画面がそのルームを覚えていないので、退出を送れないため）
 * - lobby: ロビーへ
 * - retry: もう一度
 */
export type NoticeAction = "solo" | "refresh" | "reload" | "lobby" | "retry";

export interface ErrorNotice {
	readonly code: string;
	readonly text: string;
	readonly actions: readonly NoticeAction[];
	/** 一覧を、すぐ取り直すか（参加の競合・作れないとき）。 */
	readonly refreshList: boolean;
}

export const DEFAULT_NOTICE: ErrorNotice = {
	code: "",
	text: "うまくつながりません。もう一度お試しください",
	actions: ["retry"],
	refreshList: false,
};

const notice = (
	text: string,
	actions: readonly NoticeAction[],
	refreshList = false,
) => ({ text, actions, refreshList });

const TABLE: Readonly<
	Record<(typeof SERVER_ERROR_CODES)[number], Omit<ErrorNotice, "code">>
> = {
	"room-limit": notice(
		"いまは、ルームがいっぱいです。少し待つか、ひとり用のゲームで遊んでください",
		["solo", "refresh"],
		true,
	),
	"room-full": notice(
		"ちょうど満員になりました。ほかのルームを選んでください",
		[],
		true,
	),
	"game-already-started": notice(
		"そのルームは、もう始まっています。ほかのルームを選ぶか、新しく作ってください",
		[],
		true,
	),
	"room-not-found": notice("そのルームは、もうありません", [], true),
	"already-joined": notice("もうそのルームに入っています", []),
	"already-in-room": notice(
		"前のルームに入ったままです。画面を読み込み直してから、もう一度お試しください",
		["reload"],
	),
	"reconnect-failed": notice(
		"前のルームには戻れませんでした。もう一度ルームに入ってください",
		["lobby"],
	),
	"room-closed": notice(
		"ルームが閉じました。ロビーへ戻って、もう一度ルームに入ってください",
		["lobby"],
	),
	"unknown-game": notice(
		"そのルームは作れませんでした。設定を変えて、もう一度お試しください",
		[],
	),
	"invalid-settings": notice(
		"そのルームは作れませんでした。設定を変えて、もう一度お試しください",
		[],
	),
	"server-error": notice(DEFAULT_NOTICE.text, ["retry"]),
	"bad-message": notice(DEFAULT_NOTICE.text, ["retry"]),
};

function known(code: string): code is (typeof SERVER_ERROR_CODES)[number] {
	return (SERVER_ERROR_CODES as readonly string[]).includes(code);
}

/** エラーの種類から、文言と次の行動。 */
export function noticeFor(code: string): ErrorNotice {
	return known(code) ? { code, ...TABLE[code] } : { ...DEFAULT_NOTICE, code };
}
