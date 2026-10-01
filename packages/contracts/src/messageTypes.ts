/**
 * メッセージ種別の一覧（issue-31 / ADR 0009）。
 *
 * Gleam 側（server/src/rondo_server/protocol/message.gleam）との対応を守るための正。
 * 型（ClientMessage / ServerMessage）と食い違うと、下の型検査で型エラーになる。
 */

import type { ClientMessage, ServerMessage } from "./messages";

export const CLIENT_MESSAGE_TYPES = [
	"set-name",
	"list-rooms",
	"create-room",
	"join-room",
	"leave-room",
	"reconnect",
	"game-event",
] as const satisfies readonly ClientMessage["type"][];

export const SERVER_MESSAGE_TYPES = [
	"room-list",
	"room-joined",
	"player-joined",
	"player-left",
	"game-started",
	"game-state",
	"game-state-to",
	"game-ended",
	"error",
	"session",
] as const satisfies readonly ServerMessage["type"][];

// 一覧に漏れがあれば、ここが never 以外になって型エラーになる。
type Missing<All, Listed> = Exclude<All, Listed> extends never ? true : false;
const clientCovered: Missing<
	ClientMessage["type"],
	(typeof CLIENT_MESSAGE_TYPES)[number]
> = true;
const serverCovered: Missing<
	ServerMessage["type"],
	(typeof SERVER_MESSAGE_TYPES)[number]
> = true;
void clientCovered;
void serverCovered;
