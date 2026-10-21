/**
 * ロビーの一覧の、ルームの状態（issue-60）。いまの RoomSummary の項目（status・playerCount・capacity）
 * だけで決める（契約は変えない）。参加できるのは open だけ。
 *
 * - playing: ゲームが始まっている（サーバーが参加を受け付けない。veryare は鬼選出が済んだあと）。
 *   満員でも、こちらを優先する
 * - full: 人数が定員に達している（CPU も人数に数える）
 * - open: 参加できる
 * - spectate: 観戦ルーム（issue-67）。試合中でも、観戦者として入れる。観戦者が上限に達していれば full
 */

import type { RoomSummary } from "@rondo/contracts";

export type RoomAvailability = "open" | "full" | "playing" | "spectate";

export function roomAvailability(room: RoomSummary): RoomAvailability {
	if (room.spectate === true) {
		return room.playerCount >= room.capacity ? "full" : "spectate";
	}
	if (room.status === "playing") return "playing";
	if (room.playerCount >= room.capacity) return "full";
	return "open";
}

const LABELS: Readonly<Record<RoomAvailability, string>> = {
	open: "待機中",
	full: "満員",
	playing: "プレイ中",
	spectate: "観戦",
};

export function availabilityLabel(availability: RoomAvailability): string {
	return LABELS[availability];
}
