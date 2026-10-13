/**
 * ルーム名を整える規則（issue-58）。
 *
 * サーバー（server/src/rondo_server/room/room_name.gleam）が正で、ここは入力欄の検査に
 * 使う写し。両者は同じ見本（fixtures/room-names.json）を読むテストで食い違いを防ぐ。
 *
 * - 制御文字（Cc）と双方向制御（U+202A-202E, U+2066-2069）を取り除く
 * - 前後の空白（全角スペースを含む）を落とす
 * - 長さはコードポイントで数え、20 文字を超えた分は切り捨てる
 * - 空なら既定の名前（作った人の表示名 + 「のルーム」。表示名は 16 文字で切る）
 */

/** ルーム名の長さの上限（コードポイント）。 */
export const ROOM_NAME_MAX_LENGTH = 20;

const DEFAULT_SUFFIX = "のルーム";

/** 既定の名前に使う表示名の長さの上限。「のルーム」と合わせて上限に収める。 */
const OWNER_MAX_LENGTH =
	ROOM_NAME_MAX_LENGTH - Array.from(DEFAULT_SUFFIX).length;

function isRemoved(codePoint: number): boolean {
	return (
		codePoint <= 0x1f ||
		(codePoint >= 0x7f && codePoint <= 0x9f) ||
		(codePoint >= 0x202a && codePoint <= 0x202e) ||
		(codePoint >= 0x2066 && codePoint <= 0x2069)
	);
}

/** 制御文字を除き、前後の空白を落とし、limit 文字で切る。空になることがある。 */
function clean(text: string, limit: number): string {
	const kept = Array.from(text)
		.filter((char) => !isRemoved(char.codePointAt(0) ?? 0))
		.join("")
		.trim();
	return Array.from(kept).slice(0, limit).join("").trimEnd();
}

/** 入力されたルーム名を整える。空白・制御文字だけなら空文字を返す。 */
export function cleanRoomName(raw: string): string {
	return clean(raw, ROOM_NAME_MAX_LENGTH);
}

/** 名前を決めなかったときの名前（作った人の表示名 + 「のルーム」）。 */
export function defaultRoomName(owner: string): string {
	return `${clean(owner, OWNER_MAX_LENGTH)}${DEFAULT_SUFFIX}`;
}

/** ルームが持つ名前を決める。省略・空なら既定の名前。 */
export function normalizeRoomName(
	raw: string | undefined,
	owner: string,
): string {
	const name = raw === undefined ? "" : cleanRoomName(raw);
	return name === "" ? defaultRoomName(owner) : name;
}
