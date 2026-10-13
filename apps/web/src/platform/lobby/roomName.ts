/**
 * ロビーでのルーム名の表示と、入力欄の案内（issue-58）。
 *
 * 整える規則は契約（@rondo/contracts の roomName。サーバーが正）を使い、ここでは画面の
 * 文言だけを決める。識別子（roomId）は利用者に見せない。
 */

import {
	ROOM_NAME_MAX_LENGTH,
	type RoomSummary,
	cleanRoomName,
} from "@rondo/contracts";

/** 名前を持たない古いサーバーのルームに出す名前。識別子は出さない。 */
export const UNNAMED_ROOM_LABEL = "名前のないルーム";

/** 一覧に出すルーム名。 */
export function roomListLabel(room: RoomSummary): string {
	return room.name ?? UNNAMED_ROOM_LABEL;
}

/**
 * 入力中の名前に対する案内。上限を超えた・空白や制御文字だけ、のときに文言を返し、
 * それ以外は null（既定の案内のまま）。
 */
export function roomNameHint(input: string): string | null {
	if (input === "") return null;
	if (cleanRoomName(input) === "") {
		return "空白だけなので、既定の名前（あなたの名前のルーム）で作ります";
	}
	if (Array.from(input.trim()).length > ROOM_NAME_MAX_LENGTH) {
		return `${ROOM_NAME_MAX_LENGTH} 文字を超えた分は切り捨てます`;
	}
	return null;
}
